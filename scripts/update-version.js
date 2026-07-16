(function() {

    // gh workflow build piepline will update the version on push to master, but locally we don't need to do anything
    async function updateVersion() {
        try {
            // github Pages workflow build artifact will generate this file with version info on push to master
            // locally, does not need one
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
