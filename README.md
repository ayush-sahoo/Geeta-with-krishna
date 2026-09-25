# Gita with Krishna

A devotional Bhagavad Gita mobile app built with Expo + React Native and Supabase.

## Current features
- 18 chapter library
- Verse reader backed by Supabase
- English/Hindi-ready content model
- Bookmarks and reading progress for signed-in users
- "Ask Krishna" chat interface
- Supabase RLS-secured user data
- Android API 36-ready via Expo SDK 57

## Setup
1. Install Node.js 22.13+.
2. Run `npm install`.
3. Run `npx expo start`.

The Supabase publishable key in the app config is safe for client use; all exposed tables are protected with RLS.

## Backend
Supabase project: `gita-with-krishna`

## AI chat
The chat UI is wired to a Supabase Edge Function named `ask-krishna`. Add your model provider API key as a Supabase secret, then deploy the function before enabling production chat.
