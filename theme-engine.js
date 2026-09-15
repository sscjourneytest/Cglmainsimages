// theme-engine.js
(function() {
    const themeKey = 'mmh_theme';

    // 1. Core Dark Mode Logic
    const applyTheme = (theme) => {
        const isDark = theme === 'dark';
        document.body.classList.toggle('dark-mode', isDark);
        localStorage.setItem(themeKey, theme);
        
        // Custom logic for hard-coded elements
        updateHardCodedColors(isDark);
    };

    // 2. Intelligent Color Correction
    // This function fixes elements with hard-coded inline styles or complex backgrounds
    const updateHardCodedColors = (isDark) => {
        // Fix tables and analysis boxes that use solid white backgrounds
        const whiteBoxes = document.querySelectorAll('.card-dashboard, .score-item, .attempt-box, .welcome-instructions, table');
        whiteBoxes.forEach(box => {
            if (isDark) {
                if (box.style.backgroundColor === 'rgb(255, 255, 255)' || !box.style.backgroundColor) {
                    box.style.backgroundColor = 'var(--white)';
                }
            } else {
                box.style.backgroundColor = '';
            }
        });

        // Ensure text visibility on hard-coded dark text
        const darkText = document.querySelectorAll('h1, h2, h3, h4, b, strong, .qmeta');
        darkText.forEach(el => {
            el.style.color = isDark ? 'var(--text-dark)' : '';
        });
    };

    // 3. Initialize Theme
    const savedTheme = localStorage.getItem(themeKey) || 'light';
    
    // Apply immediately to prevent white flash
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => applyTheme(savedTheme));
    } else {
        applyTheme(savedTheme);
    }

    // 4. Watch for dynamic content (Quiz questions, results)
    const observer = new MutationObserver(() => {
        const currentTheme = localStorage.getItem(themeKey);
        updateHardCodedColors(currentTheme === 'dark');
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Expose toggle function to global window
    window.toggleMMHTheme = () => {
        const newTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
        applyTheme(newTheme);
    };
})();

