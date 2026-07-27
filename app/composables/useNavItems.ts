export interface NavItem {
  to: string
  label: string
  icon: string
  /** Shown as one of the four phone tabs. */
  tab?: boolean
  /** Kept out of the desktop sidebar — reachable there from within the feature. */
  phoneMenuOnly?: boolean
  /** Has sub-routes: in the menu, match exactly so parent and child don't both light. */
  exact?: boolean
  /** Only for profiles that can manage chores (admin/adult). */
  requiresManage?: boolean
  /**
   * Only for profiles with money access, and never on a wall-display device.
   * Cosmetic only — the server rejects every finance request without a live
   * finance session regardless of what the nav shows.
   */
  requiresFinance?: boolean
}

export interface NavGroup {
  key: string
  label: string
  items: NavItem[]
}

/**
 * One source of truth for navigation, projected three ways: the desktop
 * sidebar, the four phone tabs, and the full-screen phone menu. Labels are
 * built inside a computed so they re-render when the locale changes.
 */
export function useNavItems() {
  const { t } = useI18n()
  const route = useRoute()
  const { activeProfile } = useBoardState()

  const canManage = computed(() =>
    activeProfile.value?.role === 'admin' || activeProfile.value?.role === 'adult')

  // Money is hidden from profiles that have no access, and from any device
  // flagged as a wall display — a kitchen tablet shouldn't even advertise the
  // section. Both are cosmetic; the real gate is server-side.
  const { state: financeState } = useFinanceSession()
  const { isDisplayDevice } = useDeviceMode()
  const canSeeFinance = computed(() =>
    financeState.value?.enrolled === true && !isDisplayDevice.value)

  const groups = computed<NavGroup[]>(() => [
    {
      key: 'everyday',
      label: t('common.nav.groups.everyday'),
      items: [
        { to: '/', label: t('common.nav.home'), icon: 'i-lucide-house', tab: true },
        { to: '/calendar', label: t('common.nav.calendar'), icon: 'i-lucide-calendar-days', tab: true },
        { to: '/chores', label: t('common.nav.chores'), icon: 'i-lucide-list-checks', tab: true, exact: true },
        { to: '/meals', label: t('common.nav.meals'), icon: 'i-lucide-utensils' },
        { to: '/shopping', label: t('common.nav.shopping'), icon: 'i-lucide-shopping-cart', tab: true },
      ],
    },
    {
      key: 'kitchen',
      label: t('common.nav.groups.kitchen'),
      items: [
        { to: '/recipes', label: t('common.nav.recipes'), icon: 'i-lucide-chef-hat' },
        { to: '/pantry', label: t('common.nav.pantry'), icon: 'i-lucide-package' },
      ],
    },
    {
      key: 'family',
      label: t('common.nav.groups.family'),
      items: [
        { to: '/rewards', label: t('common.nav.rewards'), icon: 'i-lucide-star' },
        // Previously reachable only from inside /chores and /rewards.
        { to: '/chores/leaderboard', label: t('common.nav.leaderboard'), icon: 'i-lucide-trophy', phoneMenuOnly: true },
        { to: '/wishlists', label: t('common.nav.wishlists'), icon: 'i-lucide-gift' },
        { to: '/photos', label: t('common.nav.photos'), icon: 'i-lucide-image' },
        { to: '/finance', label: t('common.nav.money'), icon: 'i-lucide-wallet', requiresFinance: true },
      ],
    },
    {
      key: 'board',
      label: t('common.nav.groups.board'),
      items: [
        { to: '/chores/manage', label: t('common.nav.manageChores'), icon: 'i-lucide-pencil', phoneMenuOnly: true, requiresManage: true },
        { to: '/tv', label: t('common.nav.tvMode'), icon: 'i-lucide-tv' },
        { to: '/settings', label: t('common.nav.settings'), icon: 'i-lucide-settings' },
        { to: '/feedback', label: t('common.nav.feedback'), icon: 'i-lucide-megaphone' },
      ],
    },
  ])

  const allItems = computed(() => groups.value.flatMap(g => g.items))

  function permitted(item: NavItem) {
    if (item.requiresManage && !canManage.value) return false
    if (item.requiresFinance && !canSeeFinance.value) return false
    return true
  }

  /** Menu groups, with role-gated entries and now-empty groups removed. */
  const menuGroups = computed(() => groups.value
    .map(g => ({ ...g, items: g.items.filter(permitted) }))
    .filter(g => g.items.length > 0))

  /** The four phone tabs, in bar order. */
  const tabs = computed(() => allItems.value.filter(i => i.tab))

  /** Desktop sidebar — everything except the phone-menu-only extras. */
  const sidebarItems = computed(() => allItems.value.filter(i => !i.phoneMenuOnly && permitted(i)))

  /** Tab bar: prefix match, so the Chores tab stays lit on /chores/leaderboard. */
  function isTabActive(item: NavItem) {
    return item.to === '/' ? route.path === '/' : route.path.startsWith(item.to)
  }

  /** Menu rows: `exact` items match exactly, so a parent and its sub-route
   *  never highlight at the same time. */
  function isMenuActive(item: NavItem) {
    if (item.to === '/' || item.exact) return route.path === item.to
    return route.path.startsWith(item.to)
  }

  return { menuGroups, tabs, sidebarItems, isTabActive, isMenuActive }
}
