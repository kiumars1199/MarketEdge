// P6: same-page URL changes (filters, the drawer's ?m=) without a server round trip. router.push re-renders the
// page on the server (and re-runs firstPage) before the client fetch it would do anyway. Next 15 keeps
// useSearchParams / usePathname in sync with the native history API, so the screener and DrawerHost still react.
export function softNav(href: string, { replace = false, scroll = false }: { replace?: boolean; scroll?: boolean } = {}) {
  if (replace) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
  if (scroll) window.scrollTo({ top: 0 });
}
