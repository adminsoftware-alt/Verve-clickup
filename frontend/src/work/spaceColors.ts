// Space badges come from one family of navies and slates, so a sidebar full of Spaces still
// reads as one accent. A colour saved before this palette (purple, green, pink...) is shown as
// the palette colour in its place rather than as it was; picking a colour again saves one of these.
export const SPACE_COLORS = ['#234788', '#16294D', '#3B66B0', '#4A6A8A', '#5E6B7D', '#2C5470'];

export const spaceColor = (color: string | null | undefined, index: number) =>
  color && SPACE_COLORS.includes(color.toUpperCase()) ? color : SPACE_COLORS[index % SPACE_COLORS.length];
