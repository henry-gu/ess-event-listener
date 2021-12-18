exports.getLocalDate = function () {
  const dayOption = {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  };
  return today.toLocaleDateString("en-US", dayOption);
};

exports.currentDateTime = function () {
  const tzoffset = new Date().getTimezoneOffset() * 60000; //offset in milliseconds
  const localISOTime = new Date(Date.now() - tzoffset).toISOString().slice(0, -1); // remove last character
  return localISOTime;
};

exports.ChinaDateTime = function () {
  const tzoffset = -480 * 60000; //offset in milliseconds
  const localISOTime = new Date(Date.now() - tzoffset).toISOString().slice(0, -1); // remove last character
  return localISOTime;
};
