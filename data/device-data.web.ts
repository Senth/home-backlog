import AsyncStorage from "@react-native-async-storage/async-storage";
import { signOut } from "firebase/auth";
import { clearIndexedDbPersistence, terminate } from "firebase/firestore";
import { auth, db } from "@/config/firebase";

export async function clearDeviceData(): Promise<void> {
	await AsyncStorage.clear();
	await terminate(db);
	await clearIndexedDbPersistence(db);
	await signOut(auth);
	window.location.replace("/login");
}
