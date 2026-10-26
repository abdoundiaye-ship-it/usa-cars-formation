import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Application entièrement dynamique (données par utilisateur) : pas de cache incrémental (R2) nécessaire.
export default defineCloudflareConfig();
