import Ionicons from "@expo/vector-icons/Ionicons";
import * as Application from "expo-application";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors } from "@/lib/ui";

/** How often a running app looks again after coming back to the foreground. */
const APK_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const OTA_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const APK_PREFIX = "gstpro-update-";

type AndroidRelease = { versionCode: number; versionName: string; size: number; mandatory: boolean; downloadUrl: string };

/**
 * Keeps an installed app current, the same two ways as the CRM app:
 *
 * - A newer JavaScript bundle (most changes): expo-updates fetches it on
 *   launch by itself; this also checks when the app returns to the
 *   foreground, then offers a restart so the change shows at once.
 * - A newer APK (native changes): when the server reports a higher
 *   versionCode than this install, offer to download it and open Android's
 *   installer. Android only installs it over this app when it is signed with
 *   the same key, so a tampered download is refused.
 */
export function AppUpdates() {
  const { user } = useAuth();
  const [release, setRelease] = useState<AndroidRelease | null>(null);
  const [dismissedCode, setDismissedCode] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [otaDismissed, setOtaDismissed] = useState(false);
  const lastApkCheck = useRef(0);
  const lastOtaCheck = useRef(0);
  const { isUpdatePending } = Updates.useUpdates();
  const installedCode = Number(Application.nativeBuildVersion ?? 0);

  const checkApk = useCallback(async (force = false) => {
    if (Platform.OS !== "android" || !user || __DEV__) return;
    if (!force && Date.now() - lastApkCheck.current < APK_CHECK_INTERVAL_MS) return;
    lastApkCheck.current = Date.now();
    try {
      const latest = await api<AndroidRelease>("/app/android/latest");
      setRelease(installedCode > 0 && latest.versionCode > installedCode ? latest : null);
    } catch (e) {
      // 404 just means nothing has been published yet.
      if (!(e instanceof ApiError && e.status === 404)) console.warn("App update check failed", e);
    }
  }, [user, installedCode]);

  const checkOta = useCallback(async () => {
    if (__DEV__ || !Updates.isEnabled) return;
    if (Date.now() - lastOtaCheck.current < OTA_CHECK_INTERVAL_MS) return;
    lastOtaCheck.current = Date.now();
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) await Updates.fetchUpdateAsync();
    } catch {
      // Offline or the server is busy: the next launch tries again.
    }
  }, []);

  useEffect(() => {
    void checkApk(true);
    void clearOldDownloads();
  }, [checkApk]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void checkApk();
      void checkOta();
    });
    return () => sub.remove();
  }, [checkApk, checkOta]);

  async function installApk() {
    if (!release) return;
    setError(null);
    setProgress(0);
    try {
      const target = `${FileSystem.cacheDirectory}${APK_PREFIX}${release.versionCode}.apk`;
      await FileSystem.deleteAsync(target, { idempotent: true });
      const download = FileSystem.createDownloadResumable(release.downloadUrl, target, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        const total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : release.size;
        if (total > 0) setProgress(Math.min(1, totalBytesWritten / total));
      });
      const result = await download.downloadAsync();
      if (!result || result.status !== 200) throw new Error("The download did not complete.");
      const info = await FileSystem.getInfoAsync(target);
      if (!info.exists || (release.size > 0 && info.size !== release.size)) throw new Error("The downloaded file is incomplete.");
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: await FileSystem.getContentUriAsync(target),
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION, so the installer can read our file
        type: "application/vnd.android.package-archive",
      });
    } catch (e: any) {
      setError(e?.message ?? "The update could not be downloaded.");
    } finally {
      setProgress(null);
    }
  }

  const showApk = !!release && (release.mandatory || dismissedCode !== release.versionCode);
  if (!showApk) {
    if (!isUpdatePending || otaDismissed) return null;
    return (
      <View style={s.banner} pointerEvents="box-none">
        <View style={s.bannerCard}>
          <Ionicons name="refresh" size={18} color={colors.primary} />
          <Text style={s.bannerText}>An update is ready.</Text>
          <Pressable onPress={() => setOtaDismissed(true)} hitSlop={8}><Text style={s.muted}>Later</Text></Pressable>
          <Pressable style={s.bannerButton} onPress={() => void Updates.reloadAsync()}><Text style={s.buttonText}>Restart</Text></Pressable>
        </View>
      </View>
    );
  }

  const r = release!;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (!r.mandatory) setDismissedCode(r.versionCode); }}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Ionicons name="cloud-download-outline" size={32} color={colors.primary} />
          <Text style={s.title}>{r.mandatory ? "Update required" : "Update available"}</Text>
          <Text style={s.body}>
            GST Pro {r.versionName} (build {r.versionCode}) is ready to install.
            {r.mandatory ? " This version is needed to keep using the app." : ""}
          </Text>
          <Text style={[s.muted, s.center]}>If Android asks, allow GST Pro to install apps, then tap Update.</Text>
          {error && <Text style={s.error}>{error}</Text>}
          {progress !== null ? (
            <View style={s.row}>
              <ActivityIndicator color={colors.primary} />
              <Text style={s.body}>Downloading… {Math.round(progress * 100)}%</Text>
            </View>
          ) : (
            <View style={s.row}>
              {!r.mandatory && (
                <Pressable style={[s.button, s.secondary]} onPress={() => setDismissedCode(r.versionCode)}>
                  <Text style={[s.buttonText, { color: colors.text }]}>Later</Text>
                </Pressable>
              )}
              <Pressable style={s.button} onPress={() => void installApk()}>
                <Text style={s.buttonText}>{error ? "Try again" : "Update"}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** Downloaded installers are only needed until Android has read them. */
async function clearOldDownloads() {
  const dir = FileSystem.cacheDirectory;
  if (!dir) return;
  try {
    const names = await FileSystem.readDirectoryAsync(dir);
    await Promise.all(names.filter((n) => n.startsWith(APK_PREFIX)).map((n) => FileSystem.deleteAsync(`${dir}${n}`, { idempotent: true })));
  } catch {
    // Nothing to clean up.
  }
}

/** For the settings screen: which over-the-air update this install is running. */
export function currentUpdateLabel(): string | null {
  if (__DEV__ || !Updates.isEnabled) return null;
  if (Updates.isEmbeddedLaunch) return "App code: as installed";
  const when = Updates.createdAt?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return when ? `App code updated ${when}` : null;
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "center", padding: 24 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 22, alignItems: "center", gap: 8 },
  title: { fontSize: 19, fontWeight: "700", color: colors.text },
  body: { fontSize: 14, color: colors.text, textAlign: "center" },
  muted: { fontSize: 13, color: colors.muted },
  center: { textAlign: "center" },
  error: { fontSize: 13, color: colors.danger, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, alignSelf: "stretch", justifyContent: "center" },
  button: { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  secondary: { backgroundColor: colors.border },
  buttonText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  banner: { position: "absolute", left: 16, right: 16, bottom: 96 },
  bannerCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, elevation: 4 },
  bannerText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.text },
  bannerButton: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
});
