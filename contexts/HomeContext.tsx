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
	const [storedId, setStoredId] = useState<string | null>(null);
	const [storedLoaded, setStoredLoaded] = useState(false);

	const uid = user.uid;

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
		setHomesLoaded(false);

		return subscribeWithRetry<QuerySnapshot<DocumentData>>(
			(next, error) => onSnapshot(homesQuery(uid), next, error),
			(snapshot) => {
				setHomes(
					snapshot.docs
						.map(toHome)
						.sort((a, b) => a.name.localeCompare(b.name)),
				);
				setHomesLoaded(true);
			},
			(reason) => {
				// Handled, and only after the retries are spent: marking the query
				// answered is what stops a failed listener from holding the splash
				// forever. With no homes, `/homes` is where the ladder sends you, and
				// its empty state is also its onboarding — which is precisely why this
				// must not be reached on the first failure. An answer of "no homes" to
				// a household with a full board is the app calling a broken connection
				// onboarding, and nothing short of a restart takes it back (#101).
				console.error("Could not load your homes:", reason);
				setHomesLoaded(true);
			},
		);
	}, [uid]);

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
			setActiveHome,
		}),
		[homes, activeHome, uid, homesLoaded, storedLoaded, setActiveHome],
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
