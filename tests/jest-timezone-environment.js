const NativeEnvironment = require(
	require("jest-expo/jest-preset").testEnvironment,
);

module.exports = class extends NativeEnvironment {
	constructor(config, context) {
		const originalTz = process.env.TZ;
		if (context.docblockPragmas.timezone) {
			process.env.TZ = context.docblockPragmas.timezone;
		}
		super(config, context);
		this.originalTz = originalTz;
	}

	async teardown() {
		try {
			await super.teardown();
		} finally {
			if (this.originalTz === undefined) {
				delete process.env.TZ;
			} else {
				process.env.TZ = this.originalTz;
			}
		}
	}
};
