"use strict";

const eventTopicSelect = document.getElementById("eventTopicSelect");
if (eventTopicSelect) {
  eventTopicSelect.addEventListener("change", function () {
    this.form.submit();
  });
}
