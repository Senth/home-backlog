import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "firebase/auth";
import {
	type DocumentData,
	onSnapshot,
	type QuerySnapshot,
} from "firebase/firestore";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { homesQuery, profileOf, saveMyProfile, toHome } from "@/data/homes";
import { subscribeWithRetry } from "@/data/live-query";
import { resolveActiveHomeId } from "@/models/active-home";
import { emailHash, type Home, type Role } from "@/models/home";

/**
 * Which homes I am in, and which one I am looking at.
 *
 * Mounted inside the resolved-auth half of the tree (`app/(app)/_layout.tsx`),
 * so `user` here is an answer and never a not-yet — this provider cannot race
 * auth, and the homes query it fires is never made without a uid.
 *
 * One listener, as wide as the number of homes one person belongs to. The cost
 * risk in this app is listener *breadth*, not data volume, and this is the only
 * listener that is not scoped to a single home. It is opened once per session
 * and re-opened only to replace one Firestore has already torn down — see
 * `subscribeWithRetry`.
 */

/** Where the last opened home is remembered between launches. */
const activeHomeKey = "home-backlog.activeHomeId";

interface HomeContextType {
	/** Every home I am a member of, by name. */
	homes: Home[];
	activeHome: Home | null;
	/** My role in the active home, or null when there is no active home. */
	myRole: Role | null;
	/**
	 * True until both the persisted id has been read and the homes query has
	 * answered. Nothing may route on which home is active before this is false —
	 * the splash holds the router until then, the same way `AuthGate` does.
	 */
	loading: boolean;
	/**
	 * True once the homes query has given up, which makes `homes` the last thing
	 * that arrived rather than an answer — on a first launch, nothing at all.
	 *
	 * Screens have to say so instead of drawing an empty list, because an empty
	 * list here *is* the onboarding: "You are not in any home yet", with a button
	 * offering to make the first one. Told that by a broken connection, somebody
	 * who has had a home for a year either believes it or creates a second one.
	 */
	failed: boolean;
	/** Opens the homes query again after it gave up. */
	retry: () => void;
	/**
	 * True while a `retry` is in flight. Unlike `loading` it does not hold the
	 * router — the screen stays where it is and says so on the button itself.
	 */
	retrying: boolean;
	/** Switches home and remembers it. */
	setActiveHome: (homeId: string) => void;
}

const HomeContext = createContext<HomeContextType | undefined>(undefined);

export function HomeProvider({
	user,
	children,
}: {
	user: User;
	children: ReactNode;
}) {
	const [homes, setHomes] = useState<Home[]>([]);
	const [homesLoaded, setHomesLoaded] = useState(false);
	const [homesFailed, setHomesFailed] = useState(false);
	const [retrying, setRetrying] = useState(false);
	const [storedId, setStoredId] = useState<string | null>(null);
	const [storedLoaded, setStoredLoaded] = useState(false);
	/**
	 * Which attempt at the homes query this is. `retry` bumps it, and the effect
	 * below lists it as a dependency, so bumping it is what opens a new listener.
	 */
	const [attempt, setAttempt] = useState(0);

	const uid = user.uid;

	// Cleared *during render*, the same way `useNodes` clears a board it is being
	// re-pointed at: an effect runs after the commit, so a different person's
	// homes would be on screen for a frame — and `attempt` has to mean "attempt
	// for this uid" or the guard above would skip the splash on their first load.
	const [renderedUid, setRenderedUid] = useState(uid);
	if (renderedUid !== uid) {
		setRenderedUid(uid);
		setHomes([]);
		setHomesLoaded(false);
		setHomesFailed(false);
		setRetrying(false);
		setAttempt(0);
	}

	useEffect(() => {
		let live = true;

		AsyncStorage.getItem(activeHomeKey)
			.catch((reason) => {
				// Handled: a device that cannot remember the last home still works,
				// it just asks which one on every launch.
				console.warn("Could not read the last active home:", reason);
				return null;
			})
			.then((value) => {
				if (!live) return;
				setStoredId(value);
				setStoredLoaded(true);
			});

		return () => {
			live = false;
		};
	}, []);

	useEffect(() => {
		// Only the first attempt holds the router. `loading` swaps the whole app
		// for the splash, so doing it again on a manual retry would unmount the
		// screen the Try again button lives on — and with it the `joining` state
		// that outlives an accepted invitation on purpose. A retry that takes the
		// screen away for five seconds is not much better than the force quit it
		// replaces, so this one reports itself in place, through `retrying`.
		//
		// `failed` stays set for the same reason: cleared here, a retry in flight
		// would drop the screen back to "You are not in any home yet" — the exact
		// sentence this is all here to stop. Only an arriving snapshot clears it.
		if (attempt === 0) {
			setHomesLoaded(false);
			setHomesFailed(false);
		}
		setRetrying(attempt > 0);

		return subscribeWithRetry<QuerySnapshot<DocumentData>>(
			(next, error) => onSnapshot(homesQuery(uid), next, error),
			(snapshot) => {
				setHomes(
					snapshot.docs
						.map(toHome)
						.sort((a, b) => a.name.localeCompare(b.name)),
				);
				setHomesFailed(false);
				setHomesLoaded(true);
				setRetrying(false);
			},
			(reason) => {
				// Handled, and only after the retries are spent: marking the query
				// answered is what stops a failed listener from holding the splash
				// forever. Not silently, though — `/homes` is where the ladder sends
				// you with no active home, and its empty state is also its onboarding.
				// An answer of "no homes" to a household with a full board is the app
				// calling a broken connection onboarding, so `failed` is what stops
				// that screen saying it, and `retry` is the way back that used to mean
				// force quitting the app (#101).
				console.error(
					`Could not load your homes, attempt ${attempt + 1}:`,
					reason,
				);
				setHomesFailed(true);
				setHomesLoaded(true);
				setRetrying(false);
			},
		);
	}, [uid, attempt]);

	const retry = useCallback(() => setAttempt((count) => count + 1), []);

	const homeIds = useMemo(() => homes.map((home) => home.id), [homes]);
	const activeHomeId = resolveActiveHomeId(homeIds, storedId);
	const activeHome = homes.find((home) => home.id === activeHomeId) ?? null;

	const setActiveHome = useCallback((homeId: string) => {
		setStoredId(homeId);
		AsyncStorage.setItem(activeHomeKey, homeId).catch((reason) => {
			// Handled: the switch has already happened in memory; only the memory
			// of it across launches is lost.
			console.warn("Could not remember the active home:", reason);
		});
	}, []);

	// The ladder can resolve to a home nobody chose — the single-home case, and
	// the case where the home you were in is gone. Writing it back is what keeps
	// the next launch from asking a question it already knows the answer to.
	useEffect(() => {
		if (activeHomeId !== null && activeHomeId !== storedId) {
			setActiveHome(activeHomeId);
		}
	}, [activeHomeId, storedId, setActiveHome]);

	// Your name and photo are yours to maintain: `memberProfiles` is how everyone
	// *else* sees you, and nothing else would ever update it after you change
	// your Google profile. Written only where it actually differs, so this is
	// silent in every session but the one after a change.
	//
	// Once per home per session, and no more. A write the rules refuse — an
	// account with no email hashes the empty string, which `ownHashIsOwn()`
	// rejects — is rolled back by Firestore, the rollback is a snapshot, the
	// snapshot re-runs this effect, and the same doomed write goes out again,
	// forever, saying nothing but a console warning. Attempting once turns that
	// loop into a single logged failure.
	const profileAttempts = useRef<{ uid: string; homeIds: Set<string> }>({
		uid,
		homeIds: new Set(),
	});

	useEffect(() => {
		const profile = profileOf(user);
		const hash = emailHash(user.email ?? "");

		// A different person signing in gets their own attempt in every home.
		if (profileAttempts.current.uid !== uid) {
			profileAttempts.current = { uid, homeIds: new Set() };
		}
		const attempted = profileAttempts.current.homeIds;

		for (const home of homes) {
			const known = home.memberProfiles[uid];
			const isStale =
				known?.displayName !== profile.displayName ||
				known?.photoURL !== profile.photoURL ||
				home.memberEmailHashes[uid] !== hash;

			if (!isStale || attempted.has(home.id)) continue;
			attempted.add(home.id);

			saveMyProfile(home.id, user).catch((reason) => {
				// Handled: a stale display name is cosmetic, and retried next launch.
				console.warn("Could not update your profile in a home:", reason);
			});
		}
	}, [homes, user, uid]);

	const value = useMemo(
		() => ({
			homes,
			activeHome,
			myRole: activeHome?.members[uid] ?? null,
			loading: !homesLoaded || !storedLoaded,
			failed: homesFailed,
			retry,
			retrying,
			setActiveHome,
		}),
		[
			homes,
			activeHome,
			uid,
			homesLoaded,
			homesFailed,
			retrying,
			storedLoaded,
			retry,
			setActiveHome,
		],
	);

	return <HomeContext.Provider value={value}>{children}</HomeContext.Provider>;
}

export function useHome() {
	const context = useContext(HomeContext);
	if (context === undefined) {
		throw new Error("useHome must be used within a HomeProvider");
	}
	return context;
}
