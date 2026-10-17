package app.sicherheitscheck;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {

    private static final int[] COLORS = {
            0xFFD93025, // BAD
            0xFFE37400, // WARN
            0xFF80868B, // MANUAL
            0xFF1A73E8, // INFO
            0xFF1E8E3E, // OK
    };
    private static final String[] LABELS = {"Handeln", "Prüfen", "Selbst prüfen", "Info", "OK"};

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private LinearLayout list;
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(16), dp(16), dp(16), dp(32));
        scroll.addView(root);

        status = text(17, true);
        root.addView(status);

        TextView note = text(14, false);
        note.setText("Diese App liest nur Einstellungen aus und ändert nichts selbst. "
                + "Sie hat keinen Internetzugriff und kann nichts senden.");
        note.setAlpha(0.75f);
        note.setPadding(0, dp(4), 0, dp(8));
        root.addView(note);

        Button refresh = new Button(this);
        refresh.setText("Erneut prüfen");
        refresh.setOnClickListener(v -> runChecks());
        root.addView(refresh);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        root.addView(list);

        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Nach Rückkehr aus den Einstellungen sofort neu prüfen.
        runChecks();
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private void runChecks() {
        status.setText("Prüfe …");
        executor.execute(() -> {
            List<Checks.Finding> findings = Checks.runAll(getApplicationContext());
            runOnUiThread(() -> {
                if (!isFinishing()) render(findings);
            });
        });
    }

    private void render(List<Checks.Finding> findings) {
        int bad = 0, warn = 0;
        for (Checks.Finding f : findings) {
            if (f.level == Checks.BAD) bad++;
            if (f.level == Checks.WARN) warn++;
        }
        if (bad == 0 && warn == 0) {
            status.setText("Keine Probleme gefunden. Die grauen Punkte bitte einmal selbst prüfen.");
        } else {
            status.setText(bad + " × Handeln, " + warn + " × Prüfen");
        }

        list.removeAllViews();
        for (Checks.Finding f : findings) list.addView(card(f));
    }

    private View card(Checks.Finding f) {
        int color = COLORS[f.level];

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(12));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(14));
        bg.setColor((color & 0x00FFFFFF) | 0x1F000000);
        bg.setStroke(dp(1), (color & 0x00FFFFFF) | 0x66000000);
        card.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(12);
        card.setLayoutParams(lp);

        LinearLayout head = new LinearLayout(this);
        head.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = text(17, true);
        title.setText(f.title);
        head.addView(title, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        TextView badge = text(12, true);
        badge.setText(LABELS[f.level]);
        badge.setTextColor(0xFFFFFFFF);
        badge.setPadding(dp(8), dp(2), dp(8), dp(2));
        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setCornerRadius(dp(10));
        badgeBg.setColor(color);
        badge.setBackground(badgeBg);
        head.addView(badge);
        card.addView(head);

        TextView summary = text(15, false);
        summary.setText(f.summary);
        summary.setPadding(0, dp(6), 0, 0);
        card.addView(summary);

        for (Checks.Item item : f.items) {
            TextView t = text(15, false);
            t.setPadding(dp(4), dp(8), 0, dp(4));
            if (item.pkg != null) {
                t.setText("›  " + item.text);
                t.setTextColor(COLORS[Checks.INFO]);
                t.setOnClickListener(v -> open("App-Info", Checks.appDetails(item.pkg)));
            } else {
                t.setText("•  " + item.text);
            }
            card.addView(t);
        }

        for (Checks.Action a : f.actions) {
            Button b = new Button(this);
            b.setText(a.label);
            b.setAllCaps(false);
            b.setOnClickListener(v -> {
                if (a.copyText != null) copy(a.copyText);
                else open(a.label, a.intents);
            });
            card.addView(b);
        }
        return card;
    }

    /** Versucht die Intents der Reihe nach – Menüs heißen je nach Hersteller anders. */
    private void open(String what, Intent... intents) {
        for (Intent i : intents) {
            try {
                startActivity(i);
                return;
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // nächsten versuchen
            }
        }
        Toast.makeText(this, what + " ließ sich nicht öffnen. Bitte in den Einstellungen suchen.",
                Toast.LENGTH_LONG).show();
    }

    private void copy(String value) {
        ClipboardManager cm = getSystemService(ClipboardManager.class);
        cm.setPrimaryClip(ClipData.newPlainText("DNS", value));
        Toast.makeText(this, value + " kopiert", Toast.LENGTH_SHORT).show();
    }

    private TextView text(int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
