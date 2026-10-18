package com.ayushsahoo.gitawithkrishna;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;

/**
 * Verse of the day notification, every morning at about 7. It shows the same
 * verse as the home page (get_daily_verse) and opens it when tapped.
 */
public class DailyVerse extends BroadcastReceiver {
    private static final String CHANNEL = "daily_verse";
    private static final int NOTIFICATION_ID = 1;
    private static final int HOUR = 7;
    private static final String VERSE_API = "https://bkwvuckznpaawmqrjjgk.supabase.co/rest/v1/rpc/get_daily_verse";
    // The site's public (publishable) key, the same one app.js uses.
    private static final String PUBLIC_KEY = "sb_publishable_xiYHK1Q_5FcGkaSbug89Qg_yeDuR3KW";
    private static final String OPEN_URL = "https://gitaverse.co.in/?utm_source=android_app&open=verse";

    /** Sets the daily alarm (again). Called when the app starts and after the phone restarts. */
    public static void schedule(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        Calendar next = Calendar.getInstance();
        next.set(Calendar.HOUR_OF_DAY, HOUR);
        next.set(Calendar.MINUTE, 0);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        if (next.getTimeInMillis() <= System.currentTimeMillis()) next.add(Calendar.DAY_OF_YEAR, 1);
        PendingIntent alarm = PendingIntent.getBroadcast(context, 0, new Intent(context, DailyVerse.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        // Inexact, so Android can batch it with other alarms to save battery.
        alarms.setInexactRepeating(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), AlarmManager.INTERVAL_DAY, alarm);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!canNotify(context)) return;
        final PendingResult result = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                show(app, fetchVerse());
            } finally {
                result.finish();
            }
        }).start();
    }

    static boolean canNotify(Context context) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context,
                Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    /** Today's verse, or null without a connection. */
    private static JSONObject fetchVerse() {
        HttpURLConnection http = null;
        try {
            http = (HttpURLConnection) new URL(VERSE_API).openConnection();
            http.setConnectTimeout(10000);
            http.setReadTimeout(10000);
            http.setRequestMethod("POST");
            http.setDoOutput(true);
            http.setRequestProperty("apikey", PUBLIC_KEY);
            http.setRequestProperty("Content-Type", "application/json");
            try (OutputStream out = http.getOutputStream()) {
                out.write("{}".getBytes(StandardCharsets.UTF_8));
            }
            if (http.getResponseCode() != 200) return null;
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            try (InputStream in = http.getInputStream()) {
                byte[] buffer = new byte[8192];
                for (int n; (n = in.read(buffer)) > 0; ) body.write(buffer, 0, n);
            }
            JSONArray rows = new JSONArray(body.toString("UTF-8"));
            return rows.length() > 0 ? rows.getJSONObject(0) : null;
        } catch (Exception e) {
            return null;
        } finally {
            if (http != null) http.disconnect();
        }
    }

    private static void show(Context context, JSONObject verse) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Verse of the day", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("A verse of the Bhagavad Gita every morning");
            manager.createNotificationChannel(channel);
        }
        String title = "Your verse for today is ready";
        String text = "Open Gita Verse to read today's wisdom.";
        String longText = text;
        if (verse != null) {
            String line = firstLine(verse.optString("sanskrit"));
            // Without the leading verse number ("2.71"), like cleanTranslation in app.js.
            String meaning = verse.optString("translation_english").replaceFirst("^\\d+\\.\\d+\\.?\\s*", "")
                    .replaceAll("\\s+", " ").trim();
            title = "Today's verse · " + verse.optInt("chapter_id") + "." + verse.optInt("verse_number");
            if (!meaning.isEmpty()) text = meaning;
            longText = line.isEmpty() ? text : line + "\n\n" + text;
        }
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(OPEN_URL), context, LauncherActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(0xFFF9BD51)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(longText))
                .setContentIntent(tap)
                .setAutoCancel(true);
        manager.notify(NOTIFICATION_ID, notification.build());
    }

    /** The verse's first line, without the speaker ("श्रीभगवानुवाच"). Same rule as loadDailyVerse in app.js. */
    private static String firstLine(String sanskrit) {
        String s = sanskrit.replaceFirst("^\\s*(?:(?:धृतराष्ट्र|सञ्जय|संजय|अर्जुन)\\s+उवाच|श्रीभगवानुवाच)\\s*[।॥|]*\\s*", "");
        int end = s.indexOf('\n');
        if (end >= 0) s = s.substring(0, end);
        return s.replaceAll("\\s*\\|+\\s*$", " ।").trim();
    }

    /** Sets the alarm again after the phone restarts (alarms are cleared on restart). */
    public static class AfterRestart extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) schedule(context);
        }
    }
}
