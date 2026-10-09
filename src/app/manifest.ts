import type { MetadataRoute } from "next";

// Installed to the home screen, Marginalia opens on its own, on paper, with no browser around it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Marginalia",
    short_name: "Marginalia",
    // The #59 spike opens on its page, since the home-screen app has no address bar; #63 puts back "/".
    start_url: "/spike/google",
    display: "standalone",
    background_color: "#f3ecdd",
    theme_color: "#f3ecdd",
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
