exports.getLocalDate = function () {
  const dayOption = {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  };
  return new Date().toLocaleDateString("en-US", dayOption);
};

exports.currentDateTime = function () {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  const localISOTime = new Date(Date.now() + offsetMinutes * 60000)
    .toISOString()
    .slice(0, -1);
  return `${localISOTime} UTC${sign}${hours}:${minutes}`;
};

exports.getChinaDateTime = function () {
  const localISOTime = new Date(Date.now() + 480 * 60000).toISOString().slice(0, -1);
  return localISOTime + " UTC+08:00";
};

exports.getUTCDateTime = function () {
  const utcTime = new Date().toISOString().slice(0, -1);
  return utcTime + " UTC";
};
