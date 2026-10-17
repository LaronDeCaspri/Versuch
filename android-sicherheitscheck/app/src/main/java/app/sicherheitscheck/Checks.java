package app.sicherheitscheck;

import android.Manifest;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.KeyguardManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.accessibility.AccessibilityManager;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/**
 * Liest Sicherheitseinstellungen aus. Ändert nichts und sendet nichts
 * (die App hat keine Internet-Berechtigung).
 */
final class Checks {

    static final int BAD = 0, WARN = 1, MANUAL = 2, INFO = 3, OK = 4;

    static final String ADGUARD_DNS = "dns.adguard-dns.com";

    static final class Item {
        final String text;
        final String pkg; // null = nicht anklickbar

        Item(String text, String pkg) {
            this.text = text;
            this.pkg = pkg;
        }
    }

    static final class Action {
        final String label;
        final Intent[] intents; // werden der Reihe nach versucht
        final String copyText;  // statt Intent: Text in die Zwischenablage

        Action(String label, Intent... intents) {
            this.label = label;
            this.intents = intents;
            this.copyText = null;
        }

        Action(String label, String copyText) {
            this.label = label;
            this.intents = new Intent[0];
            this.copyText = copyText;
        }
    }

    static final class Finding {
        int level;
        final String title;
        String summary = "";
        final List<Item> items = new ArrayList<>();
        final List<Action> actions = new ArrayList<>();

        Finding(String title) {
            this.title = title;
        }
    }

    private Checks() {
    }

    static List<Finding> runAll(Context c) {
        PackageManager pm = c.getPackageManager();
        List<PackageInfo> allPkgs = installedPackages(pm);
        List<PackageInfo> userPkgs = new ArrayList<>();
        for (PackageInfo pi : allPkgs) {
            if (pi.applicationInfo != null && isUserApp(pi.applicationInfo)
                    && !pi.packageName.equals(c.getPackageName())) {
                userPkgs.add(pi);
            }
        }

        List<Finding> out = new ArrayList<>();
        out.add(safe("Sicherheitsupdate", Checks::securityPatch));
        out.add(safe("Displaysperre", () -> screenLock(c)));
        out.add(safe("Geräteadministratoren", () -> deviceAdmins(c, pm)));
        out.add(safe("Bedienungshilfen", () -> accessibility(c, pm)));
        out.add(safe("Zugriff auf Benachrichtigungen", () -> notificationListeners(c, pm)));
        out.add(safe("USB-Debugging", () -> debugging(c)));
        out.add(safe("Privates DNS (Werbeblocker)", () -> privateDns(c)));
        out.addAll(permissions(pm, userPkgs));
        out.add(safe("Unbekannte Apps installieren", () -> installSources(pm, allPkgs)));
        out.add(adId());
        out.add(googleAccount());
        out.add(playProtect());
        return out;
    }

    private static Finding safe(String title, Supplier<Finding> check) {
        try {
            return check.get();
        } catch (RuntimeException e) {
            Finding f = new Finding(title);
            f.level = MANUAL;
            f.summary = "Konnte auf diesem Gerät nicht automatisch geprüft werden. Bitte selbst in den Einstellungen nachsehen.";
            f.actions.add(new Action("Einstellungen öffnen", settings()));
            return f;
        }
    }

    // --- Einzelne Prüfungen -------------------------------------------------

    private static Finding securityPatch() {
        Finding f = new Finding("Sicherheitsupdate");
        LocalDate patch = LocalDate.parse(Build.VERSION.SECURITY_PATCH);
        long days = ChronoUnit.DAYS.between(patch, LocalDate.now());
        f.level = days <= 90 ? OK : days <= 180 ? WARN : BAD;
        f.summary = "Android " + Build.VERSION.RELEASE + ", Sicherheitspatch vom "
                + patch.format(DateTimeFormatter.ofPattern("dd.MM.yyyy")) + " (vor " + days + " Tagen).";
        if (f.level == WARN) {
            f.summary += " Nach Updates suchen und installieren.";
        } else if (f.level == BAD) {
            f.summary += " Kommt kein Update mehr, ist das Handy dauerhaft für bekannte Lücken angreifbar – keine Einstellung kann das ausgleichen.";
        }
        f.actions.add(new Action("Nach Updates suchen",
                new Intent("android.settings.SYSTEM_UPDATE_SETTINGS"),
                new Intent(Settings.ACTION_DEVICE_INFO_SETTINGS),
                settings()));
        return f;
    }

    private static Finding screenLock(Context c) {
        Finding f = new Finding("Displaysperre");
        KeyguardManager km = c.getSystemService(KeyguardManager.class);
        if (km.isDeviceSecure()) {
            f.level = OK;
            f.summary = "Aktiv. Ob PIN oder Muster, kann die App nicht sehen – empfohlen ist eine PIN mit mindestens 6 Ziffern.";
        } else {
            f.level = BAD;
            f.summary = "Keine Displaysperre! Jeder, der das Handy in die Hand bekommt, hat vollen Zugriff. PIN mit mindestens 6 Ziffern einrichten.";
        }
        f.actions.add(new Action("Displaysperre einrichten",
                new Intent(Settings.ACTION_SECURITY_SETTINGS), settings()));
        return f;
    }

    private static Finding deviceAdmins(Context c, PackageManager pm) {
        Finding f = new Finding("Geräteadministratoren");
        DevicePolicyManager dpm = c.getSystemService(DevicePolicyManager.class);
        List<ComponentName> admins = dpm.getActiveAdmins();
        Set<String> pkgs = new LinkedHashSet<>();
        if (admins != null) {
            for (ComponentName cn : admins) pkgs.add(cn.getPackageName());
        }
        int user = addApps(f, pm, pkgs);
        if (pkgs.isEmpty()) {
            f.level = OK;
            f.summary = "Keine App hat Administratorrechte.";
        } else if (user == 0) {
            f.level = OK;
            f.summary = "Nur vorinstallierte Apps (z. B. „Mein Gerät finden“).";
        } else {
            f.level = BAD;
            f.summary = user + " selbst installierte App(s) mit Administratorrechten. Das ist typisch für Spionage-Apps. "
                    + "Kennst du sie nicht: Rechte entziehen, dann App löschen.";
        }
        f.actions.add(new Action("Geräteadministratoren öffnen",
                component("com.android.settings", "com.android.settings.Settings$DeviceAdminSettingsActivity"),
                component("com.android.settings", "com.android.settings.DeviceAdminSettings"),
                new Intent(Settings.ACTION_SECURITY_SETTINGS),
                settings()));
        return f;
    }

    private static Finding accessibility(Context c, PackageManager pm) {
        Finding f = new Finding("Bedienungshilfen");
        AccessibilityManager am = c.getSystemService(AccessibilityManager.class);
        Set<String> pkgs = new LinkedHashSet<>();
        for (AccessibilityServiceInfo si
                : am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)) {
            if (si.getResolveInfo() != null && si.getResolveInfo().serviceInfo != null) {
                pkgs.add(si.getResolveInfo().serviceInfo.packageName);
            }
        }
        int user = addApps(f, pm, pkgs);
        if (user == 0) {
            f.level = OK;
            f.summary = "Keine selbst installierte App nutzt Bedienungshilfen.";
        } else {
            f.level = WARN;
            f.summary = "Diese Apps können alles auf dem Bildschirm mitlesen und selbst tippen. "
                    + "Legitim z. B. bei Passwortmanagern – alles, was du nicht kennst, abschalten.";
        }
        f.actions.add(new Action("Bedienungshilfen öffnen",
                new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS), settings()));
        return f;
    }

    private static Finding notificationListeners(Context c, PackageManager pm) {
        Finding f = new Finding("Zugriff auf Benachrichtigungen");
        // Wirft auf manchen Geräten SecurityException -> safe() meldet "selbst prüfen".
        String raw = Settings.Secure.getString(c.getContentResolver(), "enabled_notification_listeners");
        Set<String> pkgs = new LinkedHashSet<>();
        if (raw != null) {
            for (String part : raw.split(":")) {
                ComponentName cn = ComponentName.unflattenFromString(part);
                if (cn != null) pkgs.add(cn.getPackageName());
            }
        }
        int user = addApps(f, pm, pkgs);
        if (user == 0) {
            f.level = OK;
            f.summary = "Keine selbst installierte App liest deine Benachrichtigungen mit.";
        } else {
            f.level = WARN;
            f.summary = "Diese Apps lesen jede Benachrichtigung mit – also auch Nachrichten und Codes. "
                    + "Legitim z. B. bei Smartwatch-Apps – alles andere abschalten.";
        }
        f.actions.add(new Action("Benachrichtigungszugriff öffnen",
                new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS), settings()));
        return f;
    }

    private static Finding debugging(Context c) {
        Finding f = new Finding("USB-Debugging");
        ContentResolver cr = c.getContentResolver();
        boolean adb = Settings.Global.getInt(cr, Settings.Global.ADB_ENABLED, 0) == 1;
        boolean adbWifi = false;
        try {
            adbWifi = Settings.Global.getInt(cr, "adb_wifi_enabled", 0) == 1;
        } catch (SecurityException ignored) {
            // auf neueren Android-Versionen nicht lesbar
        }
        boolean dev = Settings.Global.getInt(cr, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1;
        if (adb || adbWifi) {
            f.level = BAD;
            f.summary = (adbWifi ? "Debugging über WLAN ist an. " : "USB-Debugging ist an. ")
                    + "Damit kann ein angeschlossener Computer fast alles am Handy steuern. Ausschalten.";
        } else {
            f.level = OK;
            f.summary = dev ? "Aus. (Entwickleroptionen sind sichtbar, das allein ist kein Risiko.)" : "Aus.";
        }
        if (dev) {
            f.actions.add(new Action("Entwickleroptionen öffnen",
                    new Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS), settings()));
        }
        return f;
    }

    private static Finding privateDns(Context c) {
        Finding f = new Finding("Privates DNS (Werbeblocker)");
        ConnectivityManager cm = c.getSystemService(ConnectivityManager.class);
        Network n = cm.getActiveNetwork();
        LinkProperties lp = n == null ? null : cm.getLinkProperties(n);
        if (lp == null) {
            f.level = MANUAL;
            f.summary = "Gerade keine Internetverbindung – mit WLAN oder mobilen Daten verbinden und erneut prüfen.";
        } else if (lp.getPrivateDnsServerName() != null) {
            String server = lp.getPrivateDnsServerName();
            f.level = OK;
            f.summary = "Aktiv: " + server
                    + (server.contains("adguard") ? " – blockiert Werbe- und Tracking-Server in fast allen Apps." : ".");
        } else if (lp.isPrivateDnsActive()) {
            f.level = WARN;
            f.summary = "Steht auf „Automatisch“: verschlüsselt, blockiert aber keine Werbung. "
                    + "Auf „Hostname des privaten DNS-Anbieters“ stellen und " + ADGUARD_DNS + " eintragen.";
        } else {
            f.level = WARN;
            f.summary = "Aus. Auf „Hostname des privaten DNS-Anbieters“ stellen und " + ADGUARD_DNS + " eintragen. "
                    + "Das Menü findest du über die Suche in den Einstellungen („Privates DNS“).";
        }
        if (f.level != OK) {
            f.actions.add(new Action("Adresse kopieren", ADGUARD_DNS));
            f.actions.add(new Action("Netzwerk-Einstellungen",
                    new Intent(Settings.ACTION_WIRELESS_SETTINGS), settings()));
        }
        return f;
    }

    private static List<Finding> permissions(PackageManager pm, List<PackageInfo> userPkgs) {
        // Titel -> {Stufe, wenn Apps Zugriff haben; Hinweis; Berechtigungen...}
        Map<String, String[]> groups = new LinkedHashMap<>();
        groups.put("Mikrofon", new String[]{"info",
                "Braucht eine App das Mikrofon nicht, auf „Nicht zulassen“ stellen.",
                Manifest.permission.RECORD_AUDIO});
        groups.put("Kamera", new String[]{"info",
                "Braucht eine App die Kamera nicht, auf „Nicht zulassen“ stellen.",
                Manifest.permission.CAMERA});
        groups.put("Standort immer (auch im Hintergrund)", new String[]{"warn",
                "Diese Apps wissen jederzeit, wo du bist. Fast immer reicht „Nur während der Nutzung“.",
                Manifest.permission.ACCESS_BACKGROUND_LOCATION});
        groups.put("Standort", new String[]{"info",
                "Am besten „Nur während der Nutzung“ und „Genauer Standort“ aus, wo es nicht nötig ist.",
                Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION});
        groups.put("SMS & Anrufliste", new String[]{"warn",
                "Über SMS kommen Bestätigungscodes. Nur deine SMS-/Telefon-App sollte das dürfen.",
                Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_CALL_LOG});
        groups.put("Kontakte", new String[]{"info",
                "Nur Apps, die deine Kontakte wirklich brauchen (z. B. Messenger).",
                Manifest.permission.READ_CONTACTS});

        List<Finding> out = new ArrayList<>();
        for (Map.Entry<String, String[]> g : groups.entrySet()) {
            String[] spec = g.getValue();
            List<String> perms = Arrays.asList(spec).subList(2, spec.length);
            Finding f = new Finding("Zugriff: " + g.getKey());
            Set<String> pkgs = new LinkedHashSet<>();
            for (PackageInfo pi : userPkgs) {
                if (hasGranted(pi, perms)) pkgs.add(pi.packageName);
            }
            addApps(f, pm, pkgs);
            if (pkgs.isEmpty()) {
                f.level = OK;
                f.summary = "Keine selbst installierte App hat Zugriff.";
            } else {
                f.level = "warn".equals(spec[0]) ? WARN : INFO;
                f.summary = pkgs.size() + " App(s) haben Zugriff. " + spec[1] + " Tippe auf eine App, um das zu ändern.";
            }
            out.add(f);
        }
        return out;
    }

    private static Finding installSources(PackageManager pm, List<PackageInfo> allPkgs) {
        Finding f = new Finding("Unbekannte Apps installieren");
        Set<String> pkgs = new LinkedHashSet<>();
        for (PackageInfo pi : allPkgs) {
            if (pi.requestedPermissions != null
                    && Arrays.asList(pi.requestedPermissions).contains(Manifest.permission.REQUEST_INSTALL_PACKAGES)) {
                pkgs.add(pi.packageName);
            }
        }
        addApps(f, pm, pkgs);
        f.level = MANUAL;
        f.summary = "Ob die Erlaubnis erteilt ist, kann die App nicht sehen. Bei allen Apps muss „Nicht zulassen“ stehen – "
                + "auch beim Browser oder Dateimanager, mit dem du diese App installiert hast.";
        f.actions.add(new Action("Liste öffnen",
                new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES), settings()));
        return f;
    }

    private static Finding adId() {
        Finding f = new Finding("Werbe-ID");
        f.level = MANUAL;
        f.summary = "Kann die App nicht prüfen. Unter „Werbung“ → „Werbe-ID löschen“. Danach bekommen Apps keine ID mehr, über die sie dich wiedererkennen.";
        f.actions.add(new Action("Werbe-Einstellungen öffnen",
                new Intent("com.google.android.gms.settings.ADS_PRIVACY"),
                new Intent(Settings.ACTION_PRIVACY_SETTINGS),
                settings()));
        return f;
    }

    private static Finding googleAccount() {
        Finding f = new Finding("Google-Konto");
        f.level = MANUAL;
        f.summary = "Fremde Geräte abmelden, „Bestätigung in zwei Schritten“ einschalten, "
                + "„Web- & App-Aktivitäten“, „Zeitachse“ und personalisierte Werbung ausschalten.";
        f.actions.add(new Action("Sicherheitscheck", web("https://myaccount.google.com/security-checkup")));
        f.actions.add(new Action("Daten & Datenschutz", web("https://myaccount.google.com/data-and-privacy")));
        f.actions.add(new Action("Werbung (My Ad Center)", web("https://myadcenter.google.com/")));
        return f;
    }

    private static Finding playProtect() {
        Finding f = new Finding("Google Play Protect");
        f.level = MANUAL;
        f.summary = "Kann die App nicht prüfen. Sollte eingeschaltet sein: Play Store → Profilbild → Play Protect.";
        f.actions.add(new Action("Play Protect öffnen",
                component("com.google.android.gms", "com.google.android.gms.security.settings.VerifyAppsSettingsActivity"),
                new Intent(Settings.ACTION_SECURITY_SETTINGS),
                settings()));
        return f;
    }

    // --- Hilfsfunktionen ----------------------------------------------------

    @SuppressWarnings("deprecation")
    private static List<PackageInfo> installedPackages(PackageManager pm) {
        if (Build.VERSION.SDK_INT >= 33) {
            return pm.getInstalledPackages(PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS));
        }
        return pm.getInstalledPackages(PackageManager.GET_PERMISSIONS);
    }

    private static boolean isUserApp(ApplicationInfo ai) {
        return (ai.flags & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) == 0;
    }

    private static boolean hasGranted(PackageInfo pi, List<String> perms) {
        if (pi.requestedPermissions == null || pi.requestedPermissionsFlags == null) return false;
        for (int i = 0; i < pi.requestedPermissions.length; i++) {
            if (perms.contains(pi.requestedPermissions[i])
                    && (pi.requestedPermissionsFlags[i] & PackageInfo.REQUESTED_PERMISSION_GRANTED) != 0) {
                return true;
            }
        }
        return false;
    }

    /** Hängt die Apps alphabetisch an und gibt die Anzahl selbst installierter zurück. */
    private static int addApps(Finding f, PackageManager pm, Collection<String> pkgs) {
        int user = 0;
        List<Item> items = new ArrayList<>();
        for (String pkg : pkgs) {
            String label = pkg;
            boolean isUser = false;
            try {
                ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                label = pm.getApplicationLabel(ai).toString();
                isUser = isUserApp(ai);
            } catch (PackageManager.NameNotFoundException ignored) {
                // Paket nicht sichtbar: Paketname anzeigen
            }
            if (isUser) user++;
            items.add(new Item(label + (isUser ? "" : "  (vorinstalliert)"), pkg));
        }
        items.sort(Comparator.comparing(i -> i.text.toLowerCase()));
        f.items.addAll(items);
        return user;
    }

    static Intent appDetails(String pkg) {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", pkg, null));
    }

    private static Intent component(String pkg, String cls) {
        return new Intent().setComponent(new ComponentName(pkg, cls));
    }

    private static Intent web(String url) {
        return new Intent(Intent.ACTION_VIEW, Uri.parse(url));
    }

    private static Intent settings() {
        return new Intent(Settings.ACTION_SETTINGS);
    }
}
