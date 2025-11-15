// Cohabisafe Quiz JS - WCAG Compliant, Mobile Responsive
// Handles progress, validation, adaptive skipping, localStorage for answers
// Sections: personality (35 Qs), environment (22 Qs), building (10 Qs)

let answers = JSON.parse(localStorage.getItem('cohabisafeAnswers') || '{}');
let currentSection = '';
let totalQuestions = 0;
let answeredCount = 0;

// Initialize quiz for section
function initQuiz(section, totalQs, initialAnswered = 0) {
    currentSection = section;
    totalQuestions = totalQs;
    answeredCount = initialAnswered || Object.keys(answers[section] || {}).length;

    // Load answers from localStorage
    loadSectionAnswers(section);

    // Setup event listeners
    setupQuestionListeners();
    setupAdaptiveSkipping();
    updateProgress();
    setupValidation();

    // Announce for screen readers
    const progressText = document.getElementById('progressText');
    if (progressText) {
        progressText.textContent = `Answered: ${answeredCount} of ${totalQuestions}`;
    }
}

// Load answers for current section from localStorage
function loadSectionAnswers(section) {
    if (!answers[section]) answers[section] = {};
    Object.keys(answers[section]).forEach(qid => {
        const el = document.querySelector(`[name="${getQName(qid)}"]`);
        if (el) {
            if (el.type === 'radio' || el.type === 'checkbox') {
                if (Array.isArray(answers[section][qid])) {
                    answers[section][qid].forEach(val => {
                        if (el.value === val) el.checked = true;
                    });
                } else {
                    el.checked = el.value === answers[section][qid];
                }
            } else {
                el.value = answers[section][qid];
            }
            // Trigger change for UI updates
            el.dispatchEvent(new Event('change'));
        }
    });
    updateAnsweredCount();
}

// Setup listeners for all question types
function setupQuestionListeners() {
    // Radios/Likert
    document.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', handleAnswerChange);
    });

    // Checkboxes (multi-select)
    document.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', handleAnswerChange);
    });

    // Sliders
    document.querySelectorAll('input[type="range"]').forEach(slider => {
        slider.addEventListener('input', handleSliderChange); // Use input for real-time
        slider.addEventListener('change', handleAnswerChange);
    });

    // Toggles (buttons role="radio")
    document.querySelectorAll('[role="radio"]').forEach(toggle => {
        toggle.addEventListener('click', handleToggleChange);
        toggle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleToggleChange.call(toggle, e);
            }
        });
    });

    // Textareas (conditional)
    document.querySelectorAll('textarea').forEach(textarea => {
        textarea.addEventListener('input', handleAnswerChange);
    });
}

// Handle answer change (generic)
function handleAnswerChange(e) {
    const qid = getQuestionId(e.target);
    if (!qid) return;

    saveAnswer(qid, e.target);
    updateAnsweredCount();
    updateProgress();
    checkAdaptiveSkip(qid);
}

// Specific handlers
function handleSliderChange(e) {
    const valueSpan = document.getElementById(e.target.id + '-value');
    if (valueSpan) {
        valueSpan.textContent = e.target.value;
        // Update aria-valuetext for WCAG
        e.target.setAttribute('aria-valuetext', getSliderText(e.target.value, e.target.dataset.scale || ''));
    }
}

function handleToggleChange(e) {
    // Clear previous selections in group
    const group = this.closest('[role="radiogroup"]') || this.parentElement;
    group.querySelectorAll('[role="radio"]').forEach(btn => {
        btn.setAttribute('aria-checked', 'false');
        btn.tabIndex = -1;
    });

    // Set this one
    this.setAttribute('aria-checked', 'true');
    this.tabIndex = 0;
    this.focus();

    // Handle conditional (e.g., show textarea)
    const value = this.dataset.value;
    const conditional = this.closest('.question').querySelector('textarea');
    if (conditional) {
        conditional.style.display = value === 'yes' ? 'block' : 'none';
        if (value === 'yes') conditional.focus();
    }

    handleAnswerChange({ target: this });
}

// Get question ID from element
function getQuestionId(el) {
    let qEl = el.closest('.question');
    if (!qEl) return null;
    return qEl.dataset.qid;
}

// Get name for saving (e.g., 'q1' or 'b1[]' for arrays)
function getQName(qid) {
    return currentSection === 'building' && qid.startsWith('b') ? `${qid}[]` : qid;
}

// Save answer to local object and storage
function saveAnswer(qid, el) {
    if (!answers[currentSection]) answers[currentSection] = {};

    if (el.type === 'checkbox') {
        if (!answers[currentSection][qid]) answers[currentSection][qid] = [];
        const index = answers[currentSection][qid].indexOf(el.value);
        if (el.checked) {
            if (index === -1) answers[currentSection][qid].push(el.value);
        } else {
            if (index > -1) answers[currentSection][qid].splice(index, 1);
        }
    } else {
        answers[currentSection][qid] = el.value;
    }

    localStorage.setItem('cohabisafeAnswers', JSON.stringify(answers));
}

// Update answered count (80% validation)
function updateAnsweredCount() {
    let count = 0;
    Object.keys(answers[currentSection] || {}).forEach(qid => {
        const saved = answers[currentSection][qid];
        if (Array.isArray(saved) ? saved.length > 0 : saved !== undefined && saved !== '') {
            count++;
        }
    });
    answeredCount = count;
}

// Update progress bar and text
function updateProgress() {
    const percentage = (answeredCount / totalQuestions) * 100;
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');

    if (progressBar) progressBar.setAttribute('aria-valuenow', answeredCount);
    if (progressFill) progressFill.style.width = `${percentage}%`;
    if (progressText) {
        progressText.textContent = `Answered: ${answeredCount} of ${totalQuestions} (${Math.round(percentage)}%)`;
    }
}

// Setup validation (80% on submit)
function setupValidation() {
    const form = document.getElementById('quizForm');
    const nextBtn = document.getElementById('nextBtn');
    const alert = document.getElementById('validationAlert');

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (answeredCount < totalQuestions * 0.8) {
                alert.style.display = 'block';
                alert.focus();
                // Set aria-invalid on unanswered
                document.querySelectorAll('.question').forEach(q => {
                    const qid = q.dataset.qid;
                    if (!answers[currentSection][qid]) {
                        q.querySelectorAll('input, textarea').forEach(input => {
                            input.setAttribute('aria-invalid', 'true');
                        });
                    }
                });
                return false;
            }
            submitSection();
        });
    }
}

// Adaptive skipping (e.g., if score >4 on Q1, skip Q2)
function setupAdaptiveSkipping() {
    // Example for Openness: Monitor running score
    const skipRules = {
        personality: [
            { ifQ: '1', threshold: 4, skip: '2' }, // High on Q1, skip routine pref
            { ifQ: '6', threshold: 4, skip: '7' }, // Etc.
            // Add more based on prompt (e.g., Q7 skip if high Q6, etc.)
        ],
        // Similar for other sections
    };

    // Listen to changes in key questions
    skipRules[currentSection]?.forEach(rule => {
        const ifEl = document.querySelector(`[name="${rule.ifQ}"]`);
        if (ifEl) {
            ifEl.addEventListener('change', () => checkAdaptiveSkip(rule.ifQ));
        }
    });
}

function checkAdaptiveSkip(qid) {
    // Get current score for ifQ (simplified: last selected value)
    const ifValue = answers[currentSection][qid];
    if (!ifValue) return;

    // Example rule
    if (qid === '1' && parseInt(ifValue) > 4) {
        const skipContainer = document.getElementById('q2-container');
        if (skipContainer) {
            skipContainer.style.display = 'none';
            skipContainer.querySelectorAll('input').forEach(i => i.disabled = true);
            // Announce skip
            const announcement = document.createElement('div');
            announcement.setAttribute('aria-live', 'polite');
            announcement.textContent = 'Question skipped based on previous answer.';
            skipContainer.parentNode.insertBefore(announcement, skipContainer);
        }
    }
    // Implement reverse scoring in saveAnswer if needed (e.g., for Q2: value = 6 - parseInt(el.value))
}

// Multi-select limits (e.g., max 5-7)
function limitCheckboxes(groupSelector, max) {
    const group = document.querySelector(groupSelector);
    if (!group) return;

    const checkboxes = group.querySelectorAll('input[type="checkbox"]');
    const counter = group.parentElement.querySelector(`#${group.id}-counter`) || document.createElement('span');
    counter.id = `${group.id}-counter`;
    counter.setAttribute('aria-live', 'polite');
    group.parentElement.appendChild(counter);

    checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            let selected = Array.from(checkboxes).filter(c => c.checked).length;
            if (selected > max) {
                cb.checked = false;
                cb.setAttribute('aria-disabled', 'true');
                setTimeout(() => cb.removeAttribute('aria-disabled'), 1000); // Visual feedback
            } else {
                counter.textContent = `Selected: ${selected} / ${max}`;
            }
            handleAnswerChange({ target: cb });
        });
    });
}

// For building section: Setup limits
if (currentSection === 'building') {
    limitCheckboxes('#b1-group', 5);
    limitCheckboxes('.checkbox-group:has(#b3)', 7); // Example for amenities
    // Add for other Qs
}

// Submit section
function submitSection() {
    if (answeredCount < totalQuestions * 0.8) {
        alert('Please answer at least 80% of the questions to proceed.');
        return;
    }

    // Save all and redirect
    localStorage.setItem('cohabisafeAnswers', JSON.stringify(answers));

    let nextPath = '';
    if (currentSection === 'personality') {
        nextPath = '/quiz/environment';
    } else if (currentSection === 'environment') {
        nextPath = '/quiz/building';
    } else if (currentSection === 'building') {
        // POST to /quiz-submit
        const formData = new FormData();
        formData.append('answers', JSON.stringify(answers));
        formData.append('tier', localStorage.getItem('tier') || 'basic'); // From tiers

        fetch('/quiz-submit', {
            method: 'POST',
            body: formData
        }).then(res => res.json()).then(data => {
            if (data.error) {
                alert(data.error);
            } else {
                window.location.href = '/profile';
            }
        }).catch(err => console.error(err));
    }

    if (nextPath) {
        window.location.href = nextPath;
    }
}

// Slider text helpers (customize per question)
function getSliderText(value, scale) {
    const scales = {
        imagination: ['Low', 'Neutral', 'High'],
        // Add more
    };
    return `${value} - ${scales[scale]?.[Math.round(value / 4)] || 'Neutral'}`;
}

// Reverse scoring example (in saveAnswer, for reverse Qs)
function applyReverseScoring(qid, value) {
    const reverseQs = ['2', '8', '11', '19', '20', '24', '31', '33', '35']; // From prompt
    if (reverseQs.includes(qid)) {
        return 6 - parseInt(value); // For Likert 1-5
    }
    return parseInt(value);
}

// Override saveAnswer to include reverse
// In handleAnswerChange, before save: const scoredValue = applyReverseScoring(qid, el.value); then save scoredValue

// WCAG: Focus management
document.addEventListener('DOMContentLoaded', () => {
    // Skip link
    const skipLink = document.querySelector('.skip-link');
    if (skipLink) {
        skipLink.addEventListener('focus', () => {
            skipLink.style.top = '6px';
        });
        skipLink.addEventListener('blur', () => {
            skipLink.style.top = '-40px';
        });
    }

    // Auto-focus first question
    const firstQuestion = document.querySelector('.question input, .question [role="radio"]');
    if (firstQuestion) firstQuestion.focus();
});