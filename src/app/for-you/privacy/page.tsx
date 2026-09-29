import Link from "next/link";

export default function SpotifyPrivacyPage() {
  return (
    <main className="fixed inset-0 overflow-y-auto bg-black px-6 py-12 text-zinc-300">
      <div className="mx-auto max-w-2xl space-y-6 text-sm leading-relaxed">
        <Link href="/for-you" className="text-emerald-300">← Back to songs</Link>
        <h1 className="text-3xl font-semibold text-white">Spotify connection & your data</h1>
        <p>This applies to the optional Spotify connection on the For you page. It requests read-only access to your top tracks using Spotify’s user-top-read permission. It does not request your email, modify playlists, play or record Spotify audio, or send Spotify content to an AI service.</p>
        <p>Spotify supplies track titles, artists, IDs, and links. The page displays these and matches names to our independently authored learning catalog. Practice guides are ranked using your chosen instrument, comfort level, and goal. No new listening profile is created.</p>
        <p>Track data and access/refresh tokens are kept only in browser memory. They are not sent to our server or saved in local storage. Reloading or disconnecting clears them. A temporary PKCE verifier and random state are saved in session storage during login and removed when the callback is handled or you disconnect; pending login expires after ten minutes.</p>
        <p>Your practice preferences and the public Spotify Client ID are saved in local storage on this device. Clear this site’s browser data to remove them. No client secret is needed or stored.</p>
        <p>Use Disconnect on the For you page to clear the local Spotify session. To revoke Spotify’s saved authorization too, remove this app in <a href="https://www.spotify.com/account/apps/" className="text-emerald-300 underline" target="_blank" rel="noopener noreferrer">your Spotify account’s Apps settings</a>.</p>
        <p>Spotify processes login and API requests under its own <a href="https://www.spotify.com/legal/privacy-policy/" className="underline" target="_blank" rel="noopener noreferrer">privacy policy</a>. This page has no advertising, listening analytics, or background polling.</p>
      </div>
    </main>
  );
}
