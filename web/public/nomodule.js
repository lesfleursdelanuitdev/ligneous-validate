// Runs only in browsers too old for the page's module script, so the visitor
// sees why nothing happens. A plain external file, as the CSP allows.
(function () {
  var status = document.getElementById('status');
  if (!status) return;
  status.textContent = "This browser couldn't start the checker. Try a current version of Firefox, Chrome, Safari or Edge.";
  status.className = 'problem';
})();
