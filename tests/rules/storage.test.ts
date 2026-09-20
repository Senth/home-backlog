// Emulators do not model IAM, so isMember()'s firestore.get() cross-service call
// always succeeds here even without roles/firebaserules.firestoreServiceAgent —
// see scripts/project-iam.sh for the grant that makes it work in production.
import {
	assertFails,
	assertSucceeds,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import {
	getDownloadURL,
	ref,
	updateMetadata,
	uploadBytes,
} from "firebase/storage";
import {
	createTestEnv,
	HOME_ID,
	MEMBER,
	OUTSIDER,
	ownerAndMember,
	seed,
	storageAnon,
	storageAs,
} from "@/tests/rules/helpers";

let env: RulesTestEnvironment;

beforeAll(async () => {
	env = await createTestEnv();
});

afterAll(async () => {
	await env.cleanup();
});

beforeEach(async () => {
	await env.clearFirestore();
	await env.clearStorage();

	// storage.rules reads membership and the byte ceiling across services with
	// firestore.get(), so the home doc has to exist before any upload can be
	// judged.
	await seed(env, async (db) => {
		await setDoc(doc(db, `homes/${HOME_ID}`), {
			name: "Home",
			members: ownerAndMember(),
		});
	});
});

const attachmentPath = `homes/${HOME_ID}/nodes/node-1/att-1.jpg`;
const jpeg = { contentType: "image/jpeg" };
const oneByte = new Uint8Array([1]);

/** Upload `size` bytes of zeros to a path as a member. */
function upload(path: string, size: number, metadata = jpeg) {
	return uploadBytes(ref(storageAs(env, MEMBER), path), new Uint8Array(size), {
		...metadata,
		customMetadata: { uploadedBy: MEMBER.uid },
	});
}

describe("membership", () => {
	it("lets a member upload and read an attachment", async () => {
		const storage = storageAs(env, MEMBER);

		await assertSucceeds(
			uploadBytes(ref(storage, attachmentPath), oneByte, {
				...jpeg,
				customMetadata: { uploadedBy: MEMBER.uid },
			}),
		);
		await assertSucceeds(getDownloadURL(ref(storage, attachmentPath)));
	});

	it("blocks a non-member entirely", async () => {
		const storage = storageAs(env, OUTSIDER);

		await assertFails(
			uploadBytes(ref(storage, attachmentPath), oneByte, {
				...jpeg,
				customMetadata: { uploadedBy: OUTSIDER.uid },
			}),
		);
		await assertFails(getDownloadURL(ref(storage, attachmentPath)));
	});

	it("blocks an unauthenticated upload", async () => {
		await assertFails(
			uploadBytes(ref(storageAnon(env), attachmentPath), oneByte, {
				...jpeg,
				customMetadata: { uploadedBy: "nobody" },
			}),
		);
	});
});

describe("the path shape", () => {
	it("leaves a file directly under the home unreachable", async () => {
		// The counter sums everything under homes/{homeId}/, so a write
		// outside the node shape would inflate the quota with an object
		// nothing can list or clean up.
		await assertFails(upload(`homes/${HOME_ID}/loose.jpg`, 1));
	});

	it("leaves a file nested deeper than an attachment unreachable", async () => {
		await assertFails(upload(`homes/${HOME_ID}/nodes/node-1/sub/att-1.jpg`, 1));
	});

	it("leaves paths outside any home unreachable", async () => {
		await assertFails(upload("loose/file.jpg", 1));
	});
});

describe("the type allowlist", () => {
	it.each(["image/jpeg", "image/png", "image/webp", "image/heic"])(
		"allows %s",
		async (contentType) => {
			await assertSucceeds(
				upload(`homes/${HOME_ID}/nodes/node-1/pic`, 1, { contentType }),
			);
		},
	);

	it.each(["application/pdf", "text/plain"])(
		"allows %s",
		async (contentType) => {
			// A .pdf used to fail under the image-only rule; it is a document a
			// boiler plate or an appliance manual is attached as, and it is why the
			// one attachments list is not a photos list.
			await assertSucceeds(
				upload(`homes/${HOME_ID}/nodes/node-1/manual`, 1, { contentType }),
			);
		},
	);

	it.each([
		"application/zip",
		"image/gif",
		"text/html",
		"application/x-msdownload",
	])("refuses %s", async (contentType) => {
		await assertFails(
			upload(`homes/${HOME_ID}/nodes/node-1/thing`, 1, { contentType }),
		);
	});
});

describe("the size cap", () => {
	// `< 20 MB`, not `<=`: the cap is the one that never surprises anyone,
	// because hitting it is a dead end.
	it("accepts a 19 MB image", async () => {
		await assertSucceeds(upload(attachmentPath, 19 * 1024 * 1024));
	});

	it("refuses an image of exactly 20 MB", async () => {
		await assertFails(upload(attachmentPath, 20 * 1024 * 1024));
	});

	it("refuses a 21 MB image", async () => {
		await assertFails(upload(attachmentPath, 21 * 1024 * 1024));
	});
});

describe("attribution", () => {
	it("refuses customMetadata.uploadedBy naming another uid", async () => {
		await assertFails(
			uploadBytes(ref(storageAs(env, MEMBER), attachmentPath), oneByte, {
				...jpeg,
				customMetadata: { uploadedBy: OUTSIDER.uid },
			}),
		);
	});

	it("refuses an upload with no uploadedBy at all", async () => {
		await assertFails(
			uploadBytes(ref(storageAs(env, MEMBER), attachmentPath), oneByte, jpeg),
		);
	});
});

describe("the home ceiling", () => {
	it("refuses an upload when the home is at 1 GB", async () => {
		await seed(env, async (db) => {
			await setDoc(doc(db, `homes/${HOME_ID}`), {
				name: "Home",
				members: ownerAndMember(),
				attachmentBytes: 1024 * 1024 * 1024,
				attachmentBytesByUid: { [MEMBER.uid]: 1024 * 1024 * 1024 },
			});
		});

		await assertFails(upload(attachmentPath, 1));
	});

	it("accepts an upload when the home is a byte under it", async () => {
		await seed(env, async (db) => {
			await setDoc(doc(db, `homes/${HOME_ID}`), {
				name: "Home",
				members: ownerAndMember(),
				attachmentBytes: 1024 * 1024 * 1024 - 1,
			});
		});

		await assertSucceeds(upload(attachmentPath, 1));
	});
});

describe("object immutability", () => {
	// An overwrite would count the object twice — nothing deleted the first
	// bytes — so the rules allow create and nothing else. The SDK's multipart
	// POST always presents as a create to the emulator, so the closed update
	// branch is proven with a metadata edit, which presents as an update.
	it("refuses an update to an existing object", async () => {
		await assertSucceeds(upload(attachmentPath, 1));

		await assertFails(
			updateMetadata(ref(storageAs(env, MEMBER), attachmentPath), {
				contentType: "text/plain",
			}),
		);
	});
});
