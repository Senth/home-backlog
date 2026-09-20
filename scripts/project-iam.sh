#!/usr/bin/env bash
#
# The IAM bindings this project needs, declared once so drift is a diff instead of
# a mystery. Default run is a read-only audit: three sections, ok / missing /
# undeclared, exit 1 if anything is missing. `--apply` grants what is missing and
# never revokes; undeclared bindings are reported and left alone.
#
# Google-managed service agents (created and bound automatically when an API is
# enabled, and restored on their own if deleted) are filtered out of `undeclared`
# so the script does not go stale every time Google renames one. The one
# exception, `gcp-sa-firebasestorage` needing `roles/firebaserules.firestoreServiceAgent`,
# is declared explicitly below because no API enablement ever grants it.

set -euo pipefail

REPO_SLUG="Senth/home-backlog"

APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

PROJECT_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.firebaserc', 'utf8')).projects.default)")
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
OWNER_ACCOUNT=${OWNER_ACCOUNT:-$(gcloud config get-value account 2>/dev/null)}

DEPLOY_SA="github-actions-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
STORAGE_AGENT="service-${PROJECT_NUMBER}@gcp-sa-firebasestorage.iam.gserviceaccount.com"
WORKLOAD_PRINCIPAL="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO_SLUG}"

DEPLOY_SA_ROLES=(
  roles/artifactregistry.admin
  roles/cloudbuild.builds.editor
  roles/cloudfunctions.admin
  roles/datastore.indexAdmin
  roles/eventarc.admin
  roles/firebasehosting.admin
  roles/firebaserules.admin
  roles/firebasestorage.viewer
  roles/iam.serviceAccountUser
  roles/pubsub.admin
  roles/run.admin
  roles/storage.admin
  roles/serviceusage.serviceUsageConsumer
)

# member roles: "kind|scope|member|role"
# kind is "project" (project IAM policy) or "sa" (deploy service account's own
# IAM policy, granted via iam service-accounts add-iam-policy-binding)
declare -a DECLARED=()
for role in "${DEPLOY_SA_ROLES[@]}"; do
  DECLARED+=("project|${PROJECT_ID}|serviceAccount:${DEPLOY_SA}|${role}")
done
DECLARED+=("project|${PROJECT_ID}|serviceAccount:${STORAGE_AGENT}|roles/firebaserules.firestoreServiceAgent")
DECLARED+=("sa|${DEPLOY_SA}|${WORKLOAD_PRINCIPAL}|roles/iam.workloadIdentityUser")
DECLARED+=("sa|${DEPLOY_SA}|user:${OWNER_ACCOUNT}|roles/iam.serviceAccountTokenCreator")

SERVICE_AGENT_PATTERNS=(
  '*service-*@gcp-sa-*'
  '*gcf-admin-robot*'
  '*firebase-rules*'
  '*containerregistry*'
  '*serverless-robot-prod*'
  '*@cloudbuild*'
  '*@cloudservices*'
  '*@appspot*'
  '*-compute@developer*'
  '*firebase-adminsdk-**'
  '*gs-project-accounts*'
)

is_service_agent() {
  local member="$1"
  local pattern
  for pattern in "${SERVICE_AGENT_PATTERNS[@]}"; do
    # shellcheck disable=SC2053
    if [[ "$member" == $pattern ]]; then
      return 0
    fi
  done
  return 1
}

project_bindings() {
  gcloud projects get-iam-policy "$PROJECT_ID" --format=json \
    | node -e '
        const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
        for (const binding of data.bindings || []) {
          for (const member of binding.members || []) {
            console.log(`${member}|${binding.role}`);
          }
        }
      '
}

sa_bindings() {
  gcloud iam service-accounts get-iam-policy "$DEPLOY_SA" --format=json \
    | node -e '
        const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
        for (const binding of data.bindings || []) {
          for (const member of binding.members || []) {
            console.log(`${member}|${binding.role}`);
          }
        }
      '
}

mapfile -t LIVE_PROJECT < <(project_bindings)
mapfile -t LIVE_SA < <(sa_bindings)

ok=()
missing=()
for entry in "${DECLARED[@]}"; do
  IFS='|' read -r kind scope member role <<< "$entry"
  if [[ "$kind" == "project" ]]; then
    live=("${LIVE_PROJECT[@]}")
  else
    live=("${LIVE_SA[@]}")
  fi
  found=0
  for line in "${live[@]}"; do
    if [[ "$line" == "${member}|${role}" ]]; then
      found=1
      break
    fi
  done
  if [[ "$found" == 1 ]]; then
    ok+=("$entry")
  else
    missing+=("$entry")
  fi
done

undeclared=()
while IFS='|' read -r member role; do
  [[ -z "$member" ]] && continue
  is_service_agent "$member" && continue
  declared_hit=0
  for entry in "${DECLARED[@]}"; do
    IFS='|' read -r _ _ dmember drole <<< "$entry"
    if [[ "$dmember" == "$member" && "$drole" == "$role" ]]; then
      declared_hit=1
      break
    fi
  done
  if [[ "$declared_hit" == 0 ]]; then
    undeclared+=("project|${PROJECT_ID}|${member}|${role}")
  fi
done < <(printf '%s\n' "${LIVE_PROJECT[@]}")

print_section() {
  local title="$1"
  shift
  echo "$title"
  if [[ "$#" -eq 0 ]]; then
    echo "  (none)"
    return
  fi
  local entry
  for entry in "$@"; do
    IFS='|' read -r _ scope member role <<< "$entry"
    echo "  ${member}  ${role}  (${scope})"
  done
}

report() {
  print_section "ok:" "${ok[@]}"
  echo
  print_section "missing:" "${missing[@]}"
  echo
  print_section "undeclared:" "${undeclared[@]}"
}

report

if [[ "$APPLY" == 1 && "${#missing[@]}" -gt 0 ]]; then
  echo
  echo "applying missing bindings..."
  for entry in "${missing[@]}"; do
    IFS='|' read -r kind scope member role <<< "$entry"
    if [[ "$kind" == "project" ]]; then
      gcloud projects add-iam-policy-binding "$scope" \
        --member="$member" --role="$role" --condition=None >/dev/null
    else
      gcloud iam service-accounts add-iam-policy-binding "$scope" \
        --member="$member" --role="$role" >/dev/null
    fi
    echo "  granted ${member} ${role}"
  done
  echo
  echo "re-checking..."
  exec "$0"
fi

if [[ "${#missing[@]}" -gt 0 ]]; then
  exit 1
fi
exit 0
