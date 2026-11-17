import { router, useGlobalSearchParams, usePathname, useSegments, type Href } from "expo-router";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Dimensions, PanResponder, View } from "react-native";

const TABS = ["index", "invoices", "purchases", "products", "more"];
// Screens where a stray swipe would throw away what was typed.
const FORMS = new Set(["login", "new", "form", "new-user", "settings", "business", "password", "bank-import"]);

/**
 * Swipe right goes back, swipe left goes forward again to the screen you swiped
 * back from. On the tab screens with nothing to go forward to, a swipe moves to
 * the neighbouring tab. Forms and the sign-in screen ignore swipes.
 */
export function SwipeNav({ children }: { children: ReactNode }) {
  const segments: string[] = useSegments();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const here = useRef({ segments, pathname, params });
  here.current = { segments, pathname, params };
  const forward = useRef<Href[]>([]);
  const ours = useRef(false);

  // Any navigation that is not a swipe starts a new path, so forward history no longer applies.
  useEffect(() => {
    if (ours.current) ours.current = false;
    else forward.current = [];
  }, [pathname]);

  const responder = useMemo(() => {
    const go = (dir: 1 | -1) => {
      const { segments: seg, pathname: path, params: p } = here.current;
      const last = seg[seg.length - 1] ?? "";
      if (FORMS.has(last)) return;
      const tab = seg[0] === "(tabs)" ? TABS.indexOf(seg[1] ?? "index") : -1;
      if (dir === -1 && tab < 0 && router.canGoBack()) {
        forward.current.push({ pathname: path, params: p } as Href);
        ours.current = true;
        router.back();
      } else if (dir === 1 && forward.current.length) {
        ours.current = true;
        router.push(forward.current.pop()!);
      } else if (tab >= 0 && TABS[tab + dir]) {
        router.navigate(`/(tabs)/${TABS[tab + dir] === "index" ? "" : TABS[tab + dir]}` as Href);
      }
    };
    const horizontal = (dx: number, dy: number) => Math.abs(dx) > 20 && Math.abs(dx) > 2 * Math.abs(dy);
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => horizontal(g.dx, g.dy),
      onPanResponderRelease: (_, g) => {
        if (!horizontal(g.dx, g.dy)) return;
        if (Math.abs(g.dx) > Dimensions.get("window").width / 4 || Math.abs(g.vx) > 0.5) go(g.dx > 0 ? -1 : 1);
      },
    });
  }, []);

  return <View style={{ flex: 1 }} {...responder.panHandlers}>{children}</View>;
}
