export default defineAppConfig({
  ui: {
    // Nuxt UI's modal theme sets no z-index at all (unlike its toaster, which
    // uses z-[100]), and UModal portals to <body> — so its content paints with
    // z-index:auto and loses to anything positive in the same stacking context.
    // That put every dialog *behind* the phone bottom bar (z-30) and the
    // calendar's floating button (z-40). Fixed once here rather than per call
    // site; overlay precedes content in the DOM, so equal values still stack
    // content on top.
    modal: {
      slots: {
        overlay: 'z-50',
        content: 'z-50',
      },
    },
  },
})
