import AsyncStorage from "@react-native-async-storage/async-storage";
import { signOut } from "firebase/auth";
import { auth } from "@/config/firebase";

export async function clearDeviceData(): Promise<void> {
	await AsyncStorage.clear();
	await signOut(auth);
}
