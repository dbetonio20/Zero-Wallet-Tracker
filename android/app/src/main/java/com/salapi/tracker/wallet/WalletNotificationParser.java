package com.salapi.tracker.wallet;

import android.app.Notification;
import android.service.notification.StatusBarNotification;
import android.os.Bundle;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class WalletNotificationParser {
    static final String GOOGLE_WALLET_PACKAGE = "com.google.android.apps.walletnfcrel";
    private static final Pattern AMOUNT = Pattern.compile(
            "(?:₱|PHP\\s*)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern MERCHANT = Pattern.compile(
            "\\b(?:at|to)\\s+([^\\n,;]+?)(?=\\s+(?:for|using|with|on)\\b|\\s*(?:₱|PHP\\b)|\\s*[·|]\\s*(?=(?:₱|PHP\\b|EastWest|BDO|BPI|Metrobank|UnionBank|Security Bank|Citibank|HSBC|Maybank|Visa|Mastercard|Amex|Card\\b))|$)",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern CARD = Pattern.compile(
            "\\b((?:(?:EastWest|BDO|BPI|Metrobank|UnionBank|Security Bank|Citibank|HSBC|Maybank)\\s+)?(?:Visa|Mastercard|Master\\s*Card|Amex|American Express|Card)(?:\\s+[A-Za-z]+){0,2})\\s*(?:[•*xX]{2,}\\s*)(\\d{4})",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern GENERIC_TEXT = Pattern.compile(
            "^(google wallet|wallet|payment|purchase|transaction|notification)$",
            Pattern.CASE_INSENSITIVE
    );

    private WalletNotificationParser() {}

    static JSONObject parse(StatusBarNotification statusBarNotification) {
        if (!GOOGLE_WALLET_PACKAGE.equals(statusBarNotification.getPackageName())) return null;

        Notification notification = statusBarNotification.getNotification();
        Bundle extras = notification.extras;
        String title = text(extras, Notification.EXTRA_TITLE);
        String text = text(extras, Notification.EXTRA_BIG_TEXT);
        if (text.isEmpty()) text = text(extras, Notification.EXTRA_TEXT);
        CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (lines != null && text.isEmpty()) {
            StringBuilder lineText = new StringBuilder();
            for (CharSequence line : lines) {
                if (line != null) {
                    if (lineText.length() > 0) lineText.append('\n');
                    lineText.append(line);
                }
            }
            text = lineText.toString();
        }

        String content = (title + "\n" + text).trim();
        Matcher amountMatcher = AMOUNT.matcher(content);
        Double amount = null;
        boolean hasAmount = amountMatcher.find();
        if (hasAmount) {
            try {
                double parsed = Double.parseDouble(amountMatcher.group(1).replace(",", ""));
                if (parsed > 0 && Double.isFinite(parsed)) amount = parsed;
            } catch (NumberFormatException ignored) {
                amount = null;
            }
        }

        String merchantName = null;
        Matcher merchantMatcher = MERCHANT.matcher(content);
        if (merchantMatcher.find()) merchantName = cleanMerchant(merchantMatcher.group(1));
        if ((merchantName == null || merchantName.isEmpty()) && hasAmount) {
            int lineStart = content.lastIndexOf('\n', amountMatcher.start());
            String beforeAmount = content.substring(lineStart + 1, amountMatcher.start()).trim();
            beforeAmount = beforeAmount.replaceFirst("(?i)^(?:you\\s+(?:spent|paid)|purchase(?:\\s+at)?)\\s+", "");
            merchantName = cleanMerchant(beforeAmount);
        }
        if ((merchantName == null || merchantName.isEmpty())
                && !title.isEmpty()
                && !GENERIC_TEXT.matcher(title).matches()
                && !AMOUNT.matcher(title).find()) {
            merchantName = cleanMerchant(title);
        }
        if (merchantName != null && GENERIC_TEXT.matcher(merchantName).matches()) merchantName = null;

        String cardLabel = null;
        String cardSuffix = null;
        Matcher cardMatcher = CARD.matcher(content);
        if (cardMatcher.find()) {
            cardLabel = cardMatcher.group(1).trim();
            cardSuffix = cardMatcher.group(2);
        }

        String key = statusBarNotification.getKey();
        if (key == null || key.isEmpty()) {
            key = GOOGLE_WALLET_PACKAGE + "|" + statusBarNotification.getPostTime() + "|" + title;
        }
        String fingerprint = sha256(key);

        try {
            JSONObject candidate = new JSONObject();
            candidate.put("id", "wallet-" + fingerprint);
            candidate.put("sourceApplication", GOOGLE_WALLET_PACKAGE);
            candidate.put("merchantName", merchantName == null ? JSONObject.NULL : merchantName);
            candidate.put("amount", amount == null ? JSONObject.NULL : amount);
            candidate.put("currency", amount == null ? JSONObject.NULL : "PHP");
            candidate.put("cardLabel", cardLabel == null ? JSONObject.NULL : cardLabel);
            candidate.put("cardSuffix", cardSuffix == null ? JSONObject.NULL : cardSuffix);
            candidate.put("notificationTimestamp", statusBarNotification.getPostTime());
            candidate.put("transactionTimestamp", JSONObject.NULL);
            candidate.put("fingerprint", fingerprint);
            return candidate;
        } catch (JSONException exception) {
            return null;
        }
    }

    private static String text(Bundle extras, String key) {
        CharSequence value = extras.getCharSequence(key);
        return value == null ? "" : value.toString().trim();
    }

    private static String cleanMerchant(String value) {
        String cleaned = value
                .replaceAll("(?:₱|PHP)\\s*[0-9][0-9,.]*", "")
                .replaceAll("[·|]+$", "")
                .trim();
        return cleaned.isEmpty() ? null : cleaned;
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte item : digest) result.append(String.format(Locale.ROOT, "%02x", item));
            return result.toString();
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available", exception);
        }
    }
}
