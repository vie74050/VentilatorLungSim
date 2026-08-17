import { VentSimApp } from "./src/VentSimApp.js";

// Entry point. Load via <script type="module" src="vent-scripts.js"></script>
const app = new VentSimApp(document, window);
app.init();
