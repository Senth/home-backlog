import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text } from "react-native";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { clearDeviceData } from "@/data/device-data";

jest.mock("firebase/auth", () => ({
	onAuthStateChanged: jest.fn(() => jest.fn()),
}));
jest.mock("@/config/firebase", () => ({ auth: {} }));
jest.mock("@/auth/redirect", () => ({
	consumeRedirectResult: () => Promise.resolve(null),
}));
jest.mock("@/data/device-data", () => ({ clearDeviceData: jest.fn() }));
jest.mock("@/utils/launch-timing", () => ({ markLaunch: jest.fn() }));
jest.mock("@/components/ui/SplashScreen", () => ({
	SplashScreen: () => null,
}));

const unsubscribe = jest.fn();
let result: Promise<void>;

function Session() {
	const { signOut } = useAuth();
	useEffect(() => unsubscribe, []);
	return (
		<Text
			onPress={() => {
				result = signOut();
			}}
		>
			Sign out
		</Text>
	);
}

it("unmounts session listeners before clearing storage and restores children after a failure", async () => {
	let fail: (reason: Error) => void = () => {};
	jest.mocked(clearDeviceData).mockImplementation(() => {
		expect(unsubscribe).toHaveBeenCalledTimes(1);
		return new Promise<void>((_resolve, reject) => {
			fail = reject;
		});
	});
	await render(
		<AuthProvider>
			<Session />
		</AuthProvider>,
	);
	await fireEvent.press(screen.getByText("Sign out"));
	expect(clearDeviceData).toHaveBeenCalledTimes(1);
	expect(screen.queryByText("Sign out")).toBeNull();
	const failure = new Error("storage unavailable");
	await act(async () => {
		fail(failure);
		await expect(result).rejects.toBe(failure);
	});
	expect(screen.getByText("Sign out")).toBeTruthy();
});
