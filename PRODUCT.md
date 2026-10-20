# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Individuals managing their household budget and tracking income, spending, bills, installment payments, and savings accounts.

## Product Purpose

Salapi is a zero-based personal budgeting tracker. It helps people understand income and obligations, record expenses and installment payments, plan goal-based savings, manage flexible reserves, and review their finances over time.

## Positioning

The app centers budgeting around allocating income to expenses and installment payments, with linked payment records that show what each income source has covered.

## Operating Context

People use Salapi to review their current financial picture, record and pay expenses, monitor recurring and installment obligations, manage credit cards and goal, flexible, and general savings accounts, and analyze spending. It supports individual use on Android and, as confirmed for this redesign, first-class browser layouts on tablets and larger screens.

## Capabilities and Constraints

- Existing features include income, expenses, categories, recurring items, installment schedules, credit cards, payment allocations, savings accounts with transaction history, reports, and settings.
- The app supports guest use with local data and Google sign-in with optional cloud sync.
- Preserve existing finance calculations, stored data, authentication and sync behavior, routes, and feature interactions during the UI redesign.
- The application uses Angular standalone components, Ionic Material mode, and Capacitor for Android. Browser layouts are a first-class target alongside the Android APK.

## Brand Commitments

The existing product name is Salapi. The app currently offers user-selectable color palettes and light/dark appearance; retain those settings and do not infer additional brand requirements.

## Evidence on Hand

Product capabilities and terminology are represented in the existing application under `src/app/`. No external customer claims, testimonials, or product-performance evidence have been provided; do not invent any.

## Product Principles

- Make the household budget and its remaining obligations easy to understand.
- Keep income, spending, payments, and savings connected to the user's real records.
- Support useful financial review from compact Android screens through wide browser layouts.
- Preserve user control of locally stored data, sync, appearance, and currency.

## Accessibility & Inclusion

The UI should provide readable text, sufficient color contrast, clear labels and focus states, keyboard access in browsers, and appropriately sized touch targets. No formal accessibility conformance standard has been specified.
