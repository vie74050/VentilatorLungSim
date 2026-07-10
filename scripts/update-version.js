(function() {

    async function updateVersion() {
        try {
            // github Pages workflow build artifact will generate this file with version info on push to master
            const res = await fetch("version-info.json"); 
            if (!res.ok) return;

            const info = await res.json();
            const el = document.querySelector(".sub");

            if (el) {
                el.textContent = `v${info.version} ${info.date}`;
            }
        } catch (e) {
            console.error("Version update failed", e);
        }
    }

    updateVersion();

})();
