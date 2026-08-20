import {
	assertFails,
	assertSucceeds,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
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

	// storage.rules reads membership across services with firestore.get(), so
	// the home doc has to exist before any upload can be judged.
	await seed(env, async (db) => {
		await setDoc(doc(db, `homes/${HOME_ID}`), {
			name: "Home",
			members: ownerAndMember(),
		});
	});
});

const photoPath = `homes/${HOME_ID}/nodes/node-1/photo.jpg`;
const image = { contentType: "image/jpeg" };
const oneByte = new Uint8Array([1]);

describe("storage rules", () => {
	it("lets a member upload and read an image", async () => {
		const storage = storageAs(env, MEMBER);

		await assertSucceeds(uploadBytes(ref(storage, photoPath), oneByte, image));
		await assertSucceeds(getDownloadURL(ref(storage, photoPath)));
	});

	it("blocks a non-member entirely", async () => {
		const storage = storageAs(env, OUTSIDER);

		await assertFails(uploadBytes(ref(storage, photoPath), oneByte, image));
		await assertFails(getDownloadURL(ref(storage, photoPath)));
	});

	it("blocks an unauthenticated upload", async () => {
		await assertFails(
			uploadBytes(ref(storageAnon(env), photoPath), oneByte, image),
		);
	});

	it("rejects anything that is not an image", async () => {
		await assertFails(
			uploadBytes(
				ref(storageAs(env, MEMBER), `homes/${HOME_ID}/notes.pdf`),
				oneByte,
				{ contentType: "application/pdf" },
			),
		);
	});

	it("rejects an upload over the 20 MB cap", async () => {
		const tooBig = new Uint8Array(20 * 1024 * 1024 + 1);

		await assertFails(
			uploadBytes(ref(storageAs(env, MEMBER), photoPath), tooBig, image),
		);
	});

	it("leaves paths outside a home unreachable", async () => {
		await assertFails(
			uploadBytes(
				ref(storageAs(env, MEMBER), "loose/file.jpg"),
				oneByte,
				image,
			),
		);
	});
});
