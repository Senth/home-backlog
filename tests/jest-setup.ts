// react-native-gesture-handler v3: native module + detectors are stubbed for
// jest, and the v3 root-view guard is relaxed because component tests render
// `GestureDetector` without `GestureHandlerRootView`.
import "react-native-gesture-handler/jestSetup";

jest.mock(
	"react-native-gesture-handler/lib/module/v3/detectors/useEnsureGestureHandlerRootView",
	() => ({ useEnsureGestureHandlerRootView: () => undefined }),
);
