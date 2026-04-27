function parseBoolean(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

export function isServiceDisabled() {
  return parseBoolean(process.env.FASSKOLL_KILL_SWITCH);
}

export function getServiceDisabledMessage() {
  return (
    process.env.FASSKOLL_KILL_SWITCH_MESSAGE ||
    "Tjänsten är tillfälligt avstängd. Försök igen senare."
  );
}

export function enforceKillSwitch(res) {
  if (!isServiceDisabled()) {
    return false;
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Retry-After", "300");
  res.status(503).json({
    error: getServiceDisabledMessage(),
    disabled: true,
  });
  return true;
}

