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
    // The other half of the same disease: Nuxt UI sets no z-index on its
    // floating layers either, and Reka's fixed positioner inherits the
    // content's computed z-index. With the modal raised to z-50 above, an
    // unranked select popover opened INSIDE a modal painted underneath it —
    // aria said "open" while the screen showed nothing, and on a phone
    // (no keyboard to type-and-Enter through it) the dropdown was simply
    // unusable. Every layer that can open above a modal must outrank it.
    select: {
      slots: {
        content: 'z-[60]',
      },
    },
    dropdownMenu: {
      slots: {
        content: 'z-[60]',
      },
    },
    tooltip: {
      slots: {
        content: 'z-[60]',
      },
    },
  },
})
