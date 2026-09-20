#!/usr/bin/env bash
#
# The IAM bindings this project needs, declared once so drift is a diff instead of
# a mystery. Default run is a read-only audit: ok / missing / undeclared, plus an
# informational service-agent section, exit 1 if anything is missing. `--apply`
# grants what is missing and never revokes; undeclared bindings are reported and
# left alone.
#
# Google-managed service agents (created and bound automatically when an API is
# enabled, and restored on their own if deleted) are matched by member glob, not
# by member+role, so the script does not go stale every time Google grants one
# of them a new role. A matched member's undeclared roles print in their own
# informational section instead of `undeclared`. The one exception,
# `gcp-sa-firebasestorage` needing `roles/firebaserules.firestoreServiceAgent`,
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

# member globs Google itself owns: it creates, binds and re-binds these on its
# own schedule, and it grants them whatever roles its APIs need without asking.
# A member matching one of these is never a human's deliberate grant, so it
# never belongs in the loud `undeclared` section, whatever role it carries.
SERVICE_AGENT_MEMBERS=(
  'serviceAccount:service-*@gcp-sa-*.iam.gserviceaccount.com'
  'serviceAccount:*@gcf-admin-robot.iam.gserviceaccount.com'
  'serviceAccount:*@firebase-rules.iam.gserviceaccount.com'
  'serviceAccount:*@containerregistry.iam.gserviceaccount.com'
  'serviceAccount:*@serverless-robot-prod.iam.gserviceaccount.com'
  'serviceAccount:*@cloudbuild.gserviceaccount.com'
  'serviceAccount:*@cloudservices.gserviceaccount.com'
  'serviceAccount:*@appspot.gserviceaccount.com'
  'serviceAccount:*-compute@developer.gserviceaccount.com'
  'serviceAccount:*firebase-adminsdk-*@*.iam.gserviceaccount.com'
  'serviceAccount:*@gs-project-accounts.iam.gserviceaccount.com'
)

is_service_agent_member() {
  local member="$1"
  local pattern
  for pattern in "${SERVICE_AGENT_MEMBERS[@]}"; do
    # shellcheck disable=SC2053
    [[ "$member" == $pattern ]] && return 0
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
service_agent_roles=()
scan_undeclared() {
  local kind="$1"
  local scope="$2"
  shift 2
  local live=("$@")
  local member role declared_hit entry dmember drole
  while IFS='|' read -r member role; do
    [[ -z "$member" ]] && continue
    declared_hit=0
    for entry in "${DECLARED[@]}"; do
      IFS='|' read -r _ _ dmember drole <<< "$entry"
      if [[ "$dmember" == "$member" && "$drole" == "$role" ]]; then
        declared_hit=1
        break
      fi
    done
    [[ "$declared_hit" == 1 ]] && continue
    if is_service_agent_member "$member"; then
      service_agent_roles+=("${kind}|${scope}|${member}|${role}")
    else
      undeclared+=("${kind}|${scope}|${member}|${role}")
    fi
  done < <(printf '%s\n' "${live[@]}")
}

scan_undeclared project "$PROJECT_ID" "${LIVE_PROJECT[@]}"
scan_undeclared sa "$DEPLOY_SA" "${LIVE_SA[@]}"

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
  echo
  print_section "service-agent roles (informational, not compared):" "${service_agent_roles[@]}"
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
