import { type ComponentType, useEffect, useRef } from "react";

export function recordProps<Props extends object>(
	Component: ComponentType<Props>,
) {
	const instances = new Map<object, Props>();
	function Recording(props: Props) {
		const instance = useRef({}).current;
		instances.set(instance, props);
		useEffect(() => {
			return () => {
				instances.delete(instance);
			};
		}, [instance]);
		return <Component {...props} />;
	}
	return Object.assign(Recording, {
		getProps: () => [...instances.values()],
	});
}

export type RecordedComponent<Props extends object> = ReturnType<
	typeof recordProps<Props>
>;
