import type { ImageSourcePropType } from "react-native";

/**
 * Native variant. There is no `public/` at runtime, so the bundled asset is the
 * only option — and it is on the device already, so there is nothing to wait
 * for. See `brand-mark-source.web.ts` for why web does not use this.
 */
export const brandMarkSource: ImageSourcePropType = require("@/assets/images/icon.png");
