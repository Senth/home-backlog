import { fireEvent, render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { InstallOffer } from "@/components/ui/InstallOffer";
import { PaperIcon } from "@/components/ui/PaperIcon";
import { useInstallOffer } from "@/hooks/use-install-offer";
import { lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("@/hooks/use-install-offer", () => ({
	useInstallOffer: jest.fn(),
}));

const mockedUseInstallOffer = jest.mocked(useInstallOffer);

const renderOffer = () =>
	render(
		<Provider theme={lightTheme} settings={{ icon: PaperIcon }}>
			<InstallOffer placement="top" />
		</Provider>,
	);

describe("InstallOffer", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockedUseInstallOffer.mockReturnValue({
			visible: true,
			install: jest.fn(),
			dismiss: jest.fn(),
		});
	});

	it("calls install and dismiss from their controls", async () => {
		const install = jest.fn();
		const dismiss = jest.fn();
		mockedUseInstallOffer.mockReturnValue({ visible: true, install, dismiss });
		await renderOffer();

		await fireEvent.press(
			screen.getByRole("button", { name: "install.action" }),
		);
		await fireEvent.press(screen.getByRole("button", { name: "install.hide" }));

		expect(install).toHaveBeenCalledTimes(1);
		expect(dismiss).toHaveBeenCalledTimes(1);
	});

	it("renders nothing when the offer is not visible", async () => {
		mockedUseInstallOffer.mockReturnValue({
			visible: false,
			install: jest.fn(),
			dismiss: jest.fn(),
		});
		await renderOffer();

		expect(screen.queryByText("install.offer")).toBeNull();
	});
});
