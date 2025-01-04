let autoButton = null;

// Initialize the document once it has fully loaded
document.addEventListener("DOMContentLoaded", () => {
    const toggleButton = document.getElementById("dark-mode-toggle");
    const body = document.body;
    const darkModeEnabled = localStorage.getItem("dark-mode") === "true";
    
    // Fetch initial data and set up periodic updates
    fetchData();

    // Set up Server-Sent Events (SSE) connection for real-time updates
    const eventSource = new EventSource('/api/events'); // Backend URL for events

    // Handle incoming messages from SSE
    eventSource.onmessage = function(event) {
        if (event.data === 'refresh frontend') {
            if (!isDialogOpen()) {
                fetchData();
            }
        } else {
            // Parse the event data
            const data = JSON.parse(event.data);

            // Check if the event is a log message
            if (data.type === "log" || data.type === "error") {
                // LogBox reference
                const logsContainer = document.getElementById('logs');

                // Create a new log entry
                const logEntry = document.createElement('p');
                logEntry.textContent = `${data.message}`;
                logEntry.style.color = data.type === "error" ? "red" : "inherit"; // Highlight errors in red
                
                if (!logEntry.textContent.includes("No new AMS Data or changes in Spoolman found, wait for next Updates")) logsContainer.appendChild(logEntry);

                // Limit the number of log entries to 100
                const MAX_LOG_ENTRIES = 100;
                while (logsContainer.children.length > MAX_LOG_ENTRIES) {
                    logsContainer.removeChild(logsContainer.firstChild);
                }

                // Auto-scroll to the latest log
                logsContainer.scrollTop = logsContainer.scrollHeight;
            }
        }
    };

    // Handle errors in SSE connection
    eventSource.onerror = function(error) {
        console.error("Error with the SSE connection:", error);
    };

    // Check if any modal dialog is currently open
    function isDialogOpen() {
        const dialog = document.getElementById("info-dialog");
        return dialog && dialog.open;
    }

    // Fetch and update all necessary data
    async function fetchData() {
        try {
            await Promise.all([fetchSpools(), fetchStatus()]);
        } catch (error) {
            console.error("Error fetching data:", error);
        }
    }

    // Fetch the status information from the backend
    async function fetchStatus() {
        try {
            const response = await fetch("/api/status");
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

            const status = await response.json();
            const updateTime = status.lastMqttUpdate
                ? formatDate(new Date(status.lastMqttUpdate))
                : "No update yet";

            const updateTimeAms = status.lastMqttAmsUpdate
                ? formatDate(new Date(status.lastMqttAmsUpdate))
                : "No update yet";

            // Update the UI with the fetched status
            updateStatus({
                spoolmanStatus: status.spoolmanStatus,
                mqttStatus: status.mqttStatus,
                lastMqttUpdate: updateTime,
                lastMqttAmsUpdate: updateTimeAms,
                printerSerial: status.PRINTER_ID,
                mode: status.MODE,
                showLogs: status.SHOW_LOGS_WEB,
            });

        } catch (error) {
            console.error("Error fetching status:", error);
            showError("Error retrieving connection status.");
        }
    }

    // Fetch spool information from the backend
    async function fetchSpools() {
        try {
            const response = await fetch("/api/spools");
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

            const spools = await response.json();
            updateSpools(spools);

        } catch (error) {
            console.error("Error fetching spools:", error);
            showError("Error retrieving spool data.");
        }
    }

    // Update the displayed list of spools based on fetched data
    async function updateSpools(spools) {
        const spoolListElement = getElementSafe("spool-list");
        if (!spoolListElement) return;

        spoolListElement.innerHTML = ""; // Clear previous content

        // Populate spool list with new data
        for (const amsSpool of spools) {
            const spoolRow = document.createElement("tr");

            // Calculate remaining weight of the spool
            const amsSpoolRemainingWeight = (amsSpool.slot.tray_weight / 100) * amsSpool.slot.remain;

            // Determine the color name of the spool
            let colorName = amsSpool.slot.tray_color;

            if (amsSpool.matchingExternalFilament?.name) colorName = amsSpool.matchingExternalFilament?.name;

            // Create and set up action button for the spool
            const button = document.createElement("button");
            button.type = "button";
            button.disabled = true;

            setupButton(button, amsSpool);

            button.addEventListener("click", () => {
                const content = generateDialogContent(button, amsSpool);

                let actionText;
                if (button.textContent === "Create Spool") {
                    actionText = "Create";
                } else if (button.textContent === "Merge Spool") {
                    actionText = "Merge";
                } else {
                    actionText = "Create Filament and Spool";
                }

                const actionCallback = () => performAction(button, amsSpool);
                showDialog(button, content, actionText, actionCallback);
            });

            // Populate table row with spool data
            spoolRow.innerHTML = `
                <td>${amsSpool.amsId}</td>
                <td>${amsSpool.slot.tray_sub_brands}</td>
                <td>${amsSpoolRemainingWeight} g / ${amsSpool.slot.tray_weight} g (${amsSpool.slot.remain}%)</td>
                <td style="background-color: #${amsSpool.slot.tray_color}; color: ${getTextColor(amsSpool.slot.tray_color)}">
                    ${colorName}
                </td>
                <td>${amsSpool.slot.tray_uuid}</td>
            `;

            // Add the action button to the row
            const buttonCell = document.createElement("td");
            buttonCell.appendChild(button);
            spoolRow.appendChild(buttonCell);
            spoolListElement.appendChild(spoolRow);
        }
    }

    // Configure the action button based on spool options
    function setupButton(button, amsSpool) {
        if (amsSpool.option === "Merge Spool") {
            button.textContent = "Merge Spool";
            if (amsSpool.enableButton === "true") button.disabled = false;
        } else if (amsSpool.option === "Create Spool") {
            button.textContent = "Create Spool";
            if (amsSpool.enableButton === "true") button.disabled = false;
        } else if (amsSpool.option === "Create Filament & Spool") {
            button.textContent = "Create Filament & Spool";
            if (amsSpool.enableButton === "true") button.disabled = false;
        } else {
            button.textContent = "No actions available";
        }
    }

    // Generate the content of the confirmation dialog
    function generateDialogContent(button, amsSpool) {
        if (button.textContent === "Create Spool") {
            return `
                <p>Do you really want to create a Spool with the following stats in Spoolman?</p>
                <table>
                    <tr>
                        <th>AMS Spool:</th>
                        <td>${amsSpool.slot.tray_sub_brands} - ${amsSpool.matchingExternalFilament.name} - ${amsSpool.slot.tray_uuid}</td>
                    </tr>
                    <tr>
                        <th>Spoolman Filament:</th>
                        <td>Bambu Lab - ${amsSpool.matchingInternalFilament.material} - ${amsSpool.matchingInternalFilament.name}</td>
                    </tr>
                </table>
            `;
        } else if (button.textContent === "Merge Spool") {
            let remain = (amsSpool.slot.remain / 100) * amsSpool.slot.tray_weight;

            return `
                <p>Do you really want to merge this Spool with an existing Spool in Spoolman?</p>
                <table>
                    <tr>
                        <th>AMS Spool:</th>
                        <td>${amsSpool.slot.tray_sub_brands} - ${amsSpool.matchingExternalFilament.name} - ${amsSpool.slot.tray_uuid}</td>
                    </tr>
                    <tr>
                        <th>Spoolman Spool:</th>
                        <td>Spool-ID ${amsSpool.mergeableSpool.id} - Bambu Lab - ${amsSpool.mergeableSpool.filament.material} - ${amsSpool.mergeableSpool.filament.name} - ${remain} g left on spool</td>
                    </tr>
                </table>
            `;
        } else {
            return `
                <p>Do you really want to create a Spool and a new Filament with the following stats in Spoolman?</p>
                <table>
                    <tr>
                        <th>AMS Spool:</th>
                        <td>${amsSpool.slot.tray_sub_brands} - ${amsSpool.matchingExternalFilament.name} - ${amsSpool.slot.tray_uuid}</td>
                    </tr>
                    <tr>
                        <th>New Spool & Filament:</th>
                        <td>${amsSpool.matchingExternalFilament.manufacturer} - ${amsSpool.matchingExternalFilament.material} - ${amsSpool.matchingExternalFilament.name} - ${amsSpool.matchingExternalFilament.density} g/cm³ - ${amsSpool.matchingExternalFilament.diameter} mm</td>
                    </tr>
                </table>
            `;
        }
    }

    // Show a confirmation dialog
    function showDialog(button, content, actionButtonText, actionCallback) {
        const dialog = document.getElementById("info-dialog");
        const dialogContent = document.getElementById("dialog-content");
        const closeDialog = document.getElementById("close-dialog");
        const actionButton = document.getElementById("action-button");

        dialogContent.innerHTML = content;
        updateElementText("action-button", actionButtonText);

        actionButton.onclick = () => {
            actionCallback();
            dialog.close();
        };

        closeDialog.onclick = () => dialog.close();
        dialog.showModal();
    }

    // Send the selected action to the backend
    function performAction(button, amsSpool) {
        let endpoint;

        if (button.textContent === "Create Spool") {
            endpoint = "/api/createSpool";
        } else if (button.textContent === "Merge Spool") {
            endpoint = "/api/mergeSpool";
        } else if (button.textContent === "Create Filament & Spool") {
            endpoint = "/api/createSpoolWithFilament";
        } else {
            console.log("Unknown action!");
            return;
        }

        fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(amsSpool)
        });

        button.textContent = "No actions available";
        button.disabled = true;

        alert("Action successfully sent to the backend. After the next MQTT Event, the UI will be updated. If not, please check your logs!");
    }

    // Update various status elements in the UI
    function updateStatus({ spoolmanStatus, mqttStatus, lastMqttUpdate, lastMqttAmsUpdate, printerSerial, mode, showLogs }) {
        updateElementText("spoolman-status", spoolmanStatus);
        updateElementText("mqtt-status", mqttStatus);
        updateElementText("last-mqtt-update", lastMqttUpdate);
        updateElementText("last-mqtt-ams-update", lastMqttAmsUpdate);
        updateElementText("printer-serial", printerSerial);
        updateElementText("mode", mode);
        
        const logBox = document.getElementById("log-box");
        // Überprüfen, ob die Variable true ist und den Bereich anzeigen oder ausblenden
        if (showLogs === "true") {
            logBox.style.display = "block"; // Log-Bereich anzeigen
        }
    }

    // Safely get an element by ID and log a warning if it doesn't exist
    function getElementSafe(id) {
        const element = document.getElementById(id);
        if (!element) {
            console.warn(`Element with ID "${id}" was not found.`);
        }
        return element;
    }

    // Update the text content of a specific element
    function updateElementText(id, text) {
        const element = getElementSafe(id);
        if (element) element.textContent = text;
    }

    // Display an error message to the user
    function showError(message) {
        const errorElement = getElementSafe("error-message");
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = "block";
        }
    }

    // Calculate the appropriate text color based on background brightness
    function getTextColor(hexColor) {
        const r = parseInt(hexColor.slice(0, 2), 16);
        const g = parseInt(hexColor.slice(2, 4), 16);
        const b = parseInt(hexColor.slice(4, 6), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 128 ? "black" : "white";
    }

    // Format a Date object into a human-readable string
    function formatDate(date) {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
    }
    
    // Apply dark mode if it was previously enabled
    if (darkModeEnabled) {
        body.classList.add("dark-mode");
    }

    // Handle dark mode toggle button clicks
    toggleButton.addEventListener("click", () => {
        const isDarkMode = body.classList.toggle("dark-mode");
        localStorage.setItem("dark-mode", isDarkMode);
    });

    // Additional DOMContentLoaded listener for dark mode toggle setup
    document.addEventListener("DOMContentLoaded", () => {
        const toggleButton = document.getElementById("dark-mode-toggle");
        const darkModeIcon = document.getElementById("dark-mode-icon");
        const body = document.body;

        const lightModeIcon = "https://img.icons8.com/ios-glyphs/30/moon-symbol.png";
        const darkModeIconUrl = "https://img.icons8.com/color/48/sun--v1.png";

        const isDarkMode = localStorage.getItem("dark-mode") === "true";
        if (isDarkMode) {
            body.classList.add("dark-mode");
            darkModeIcon.src = darkModeIconUrl;
        }

        toggleButton.addEventListener("click", () => {
            const darkModeEnabled = body.classList.toggle("dark-mode");
            darkModeIcon.src = darkModeEnabled ? darkModeIconUrl : lightModeIcon;
            localStorage.setItem("dark-mode", darkModeEnabled);
        });
    });
});
