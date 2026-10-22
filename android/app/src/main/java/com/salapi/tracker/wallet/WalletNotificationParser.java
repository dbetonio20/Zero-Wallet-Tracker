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
    static final java.util.Set<String> MONITORED_PACKAGES = new java.util.HashSet<>(java.util.Arrays.asList(
            GOOGLE_WALLET_PACKAGE,
            "com.globe.gcash.android",
            "ph.com.gotyme",
            "com.unionbankph.online",
            "com.rcbc.pulz",
            "com.rcbc.mobilebanking",
            "ph.seabank.seabank",
            "com.paymaya",
            "com.eastwest.mobile.dxp",
            "ph.com.metrobank.mcc.mbonline"
    ));
    private static final Pattern REFERENCE = Pattern.compile(
            "\\b(?:ref(?:erence)?|trace|txn)\\.?\\s*(?:no\\.?|number|#)?\\s*[:#]?\\s*([A-Z0-9][A-Z0-9-]{4,})\\b",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern AMOUNT = Pattern.compile(
            "(?:₱|PHP\\s*)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern VERB_AMOUNT = Pattern.compile(
            "\\b(?:received|sent|paid|spent|debited|credited|transferred)\\s+([0-9][0-9,]*\\.[0-9]{2})\\b",
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
        String sourcePackage = statusBarNotification.getPackageName();
        if (!MONITORED_PACKAGES.contains(sourcePackage)) return null;

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
        boolean hasPesoAmount = amountMatcher.find();
        if (!hasPesoAmount) {
            // GCash-style bodies omit the peso sign, e.g. "You have received 20.00 of GCash".
            amountMatcher = VERB_AMOUNT.matcher(content);
            if (!amountMatcher.find()) amountMatcher = null;
        }
        boolean hasAmount = amountMatcher != null;
        Double amount = null;
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
        if ((merchantName == null || merchantName.isEmpty()) && hasPesoAmount) {
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
            key = sourcePackage + "|" + statusBarNotification.getPostTime() + "|" + title;
        }
        String fingerprint = sha256(key);

        try {
            JSONObject candidate = new JSONObject();
            candidate.put("id", "wallet-" + fingerprint);
            candidate.put("sourceApplication", sourcePackage);
            candidate.put("merchantName", merchantName == null ? JSONObject.NULL : merchantName);
            candidate.put("amount", amount == null ? JSONObject.NULL : amount);
            candidate.put("currency", amount == null ? JSONObject.NULL : "PHP");
            candidate.put("cardLabel", cardLabel == null ? JSONObject.NULL : cardLabel);
            candidate.put("cardSuffix", cardSuffix == null ? JSONObject.NULL : cardSuffix);
            candidate.put("notificationTimestamp", statusBarNotification.getPostTime());
            candidate.put("transactionTimestamp", JSONObject.NULL);
            candidate.put("fingerprint", fingerprint);
            String[] classification = classify(content.toLowerCase(Locale.ROOT));
            candidate.put("transactionType", classification[0]);
            candidate.put("direction", classification[1]);
            Matcher referenceMatcher = REFERENCE.matcher(content);
            boolean hasReference = referenceMatcher.find() && referenceMatcher.group(1).matches(".*\\d.*");
            candidate.put("referenceNumber", hasReference
                    ? referenceMatcher.group(1).toUpperCase(Locale.ROOT) : JSONObject.NULL);
            return candidate;
        } catch (JSONException exception) {
            return null;
        }
    }

    /** Mirrors classifyNotification in notification-sources.ts. Returns {transactionType, direction}. */
    static String[] classify(String text) {
        String type;
        if (text.matches("(?s).*\\b(refund|reversed|reversal)\\b.*")) type = "refund";
        else if (text.matches("(?s).*\\b(service fee|fee|charge|convenience fee)\\b.*")) type = "fee";
        else if (text.matches("(?s).*\\b(instapay|pesonet|transfer|sent money|money sent|received money|you received)\\b.*")) type = "transfer";
        else if (text.matches("(?s).*\\b(paid|payment|spent|purchase|you paid)\\b.*")) type = "payment";
        else type = "unknown";

        String direction;
        if (text.matches("(?s).*\\b(received|incoming|credited|you got)\\b.*")) direction = "incoming";
        else if (text.matches("(?s).*\\b(sent|paid|spent|debited|outgoing|purchase)\\b.*")) direction = "outgoing";
        else direction = "unknown";

        if ("refund".equals(type)) direction = "incoming";
        return new String[] {type, direction};
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
