/** Pro Tour Broadcast palette, taken from the approved comp. Single source of colour for the world. */
export const PALETTE = {
  turf: "#2a5fc4",
  surround: "#173a7a",
  lines: "#f4f7ff",
  steel: "#0d1016",
  /** Wire of the cage's mesh: dark galvanised metal, a shade lighter than the black steel frame. */
  mesh: "#2a313c",
  glassTint: "#9fc4dc",
  ground: "#070a12",
  sky: "#05070d",
  ledBackground: "#0b1a3a",
  ledText: "#ffffff",
  azul: "#62b0ff",
  rojo: "#d8383a",
  joints: "#1a1d26",
  ball: "#e4f23a",
  /** Timing arc and label: perfect is green; early and late share amber (the label tells them apart). */
  timingPerfect: "#7bd13a",
  timingEarly: "#f5a524",
  timingLate: "#f5a524",
} as const;
