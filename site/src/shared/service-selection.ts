/**
 * Safely apply a `?service=` value to a service select without treating the
 * query string as selector syntax or HTML. Only a value already offered by
 * the form can be selected; unknown and legacy generic values stay unselected.
 */
export interface ServiceOptionLike {
  readonly value: string;
}

export interface ServiceSelectLike {
  readonly options: ArrayLike<ServiceOptionLike>;
  value: string;
}

export function preselectContactService(
  select: ServiceSelectLike,
  requestedService: string | null,
): boolean {
  if (!requestedService) return false;

  for (let index = 0; index < select.options.length; index += 1) {
    if (select.options[index]?.value === requestedService) {
      select.value = requestedService;
      return true;
    }
  }

  return false;
}
