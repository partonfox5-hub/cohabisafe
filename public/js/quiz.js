let currentStep = 1;
const totalSteps = 5;

document.addEventListener('DOMContentLoaded', () => {
    updateProgress();
    updateSectionProgress(currentStep);
    showStep(currentStep);
    
    document.querySelectorAll('.styled-slider').forEach(slider => {
        updateSliderLabel(slider);
        slider.addEventListener('input', () => updateSliderLabel(slider));
    });
});

function showStep(step) {
    document.querySelectorAll('.quiz-step').forEach(el => el.style.display = 'none');
    document.getElementById(`step-${step}`).style.display = 'block';
    
    document.getElementById('prevBtn').style.display = step === 1 ? 'none' : 'inline-block';
    
    // Logic: If last step, show 'Complete Quiz', else 'Next Section'
    if (step === totalSteps) {
        document.getElementById('nextBtn').style.display = 'none';
        document.getElementById('submitBtn').style.display = 'inline-block';
    } else {
        document.getElementById('nextBtn').style.display = 'inline-block';
        document.getElementById('submitBtn').style.display = 'none';
    }

    document.getElementById('step-indicator').innerText = `Part ${step} of ${totalSteps}`;
    updateSectionProgress(step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// NEW: Save progress to DB before moving
async function saveAndNext(n) {
    const currentStepDiv = document.getElementById(`step-${currentStep}`);
    const errorMsg = document.getElementById('error-msg');

    // Validation
    if (n === 1 && !validateStep(currentStepDiv)) {
        errorMsg.style.display = 'block';
        return; 
    }
    errorMsg.style.display = 'none';

    // Collect Data for this section
    const formData = new FormData(document.getElementById('quizForm'));
    const data = Object.fromEntries(formData.entries());

    // Send to server (Background Save)
    try {
        await fetch('/save-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step: currentStep, answers: data })
        });
    } catch (err) {
        console.error("Failed to save progress", err);
        // Proceed anyway so user isn't stuck
    }

    // Move Step
    currentStep += n;
    
    // Check if quiz is done (Move to Amenities)
    if (currentStep > totalSteps) {
        window.location.href = "/preferences"; // Redirect to Amenities page
    } else {
        showStep(currentStep);
    }
}

function changeStep(n) {
    // Legacy wrapper for back button or simple changes
    if(n === 1) {
        saveAndNext(1);
    } else {
        currentStep += n;
        showStep(currentStep);
    }
}

// Validates that all cards in the current step have an answer
function validateStep(stepDiv) {
    const questions = stepDiv.querySelectorAll('.question-card');
    let isValid = true;

    questions.forEach(card => {
        // Check Radios
        const radios = card.querySelectorAll('input[type="radio"]');
        if (radios.length > 0) {
            const checked = Array.from(radios).some(r => r.checked);
            if (!checked) isValid = false;
        }
        // Sliders and Toggles generally have a default value or use hidden inputs
    });
    return isValid;
}

function updateSliderLabel(slider) {
    const val = parseInt(slider.value);
    const parent = slider.closest('.question-card');
    const scoreDisplay = parent.querySelector('.slider-score');
    const qualitativeDisplay = parent.querySelector('.slider-qualitative');
    
    const lowLabel = slider.getAttribute('data-low') || "Low";
    const highLabel = slider.getAttribute('data-high') || "High";

    if(scoreDisplay) scoreDisplay.innerText = val;
    
    // Generate qualitative text based on 1-10
    let text = "Balanced";
    if (val <= 2) text = `Very ${lowLabel}`;
    else if (val <= 4) text = `Somewhat ${lowLabel}`;
    else if (val >= 9) text = `Very ${highLabel}`;
    else if (val >= 7) text = `Somewhat ${highLabel}`;
    
    if(qualitativeDisplay) qualitativeDisplay.innerText = text;
    
    updateProgress();
}

function updateToggleValue(checkbox, hiddenInputId, notesId) {
    // Update hidden input value: 5 if checked, 1 if unchecked
    const hiddenInput = document.getElementById(hiddenInputId);
    if (hiddenInput) {
        hiddenInput.value = checkbox.checked ? 5 : 1;
    }
    
    // Show notes if checked (or based on your logic for "Yes")
    const notes = document.getElementById(notesId);
    if (notes) {
        notes.style.display = checkbox.checked ? 'block' : 'none';
        if (!checkbox.checked) notes.value = ""; // Clear if hidden
    }

    updateProgress();
    updateSectionProgress(currentStep);
}

function toggleText(elementId, show) {
    const el = document.getElementById(elementId);
    if(el) {
        el.style.display = show ? 'block' : 'none';
        if (!show) el.value = "";
    }
    updateProgress();
}

document.addEventListener('change', (e) => {
    if (e.target.type === 'radio' || e.target.type === 'range') {
        updateProgress();
        updateSectionProgress(currentStep);
    }
});

function updateSectionProgress(step) {
    const stepDiv = document.getElementById(`step-${step}`);
    if (!stepDiv) return;

    const questions = stepDiv.querySelectorAll('.question-card');
    let answeredCount = 0;

    questions.forEach(card => {
        const radios = card.querySelectorAll('input[type="radio"]');
        const sliders = card.querySelectorAll('input[type="range"]');
        const toggles = card.querySelectorAll('input.switch'); // New toggle class
        
        if (radios.length > 0) {
            if (Array.from(radios).some(r => r.checked)) answeredCount++;
        } else if (sliders.length > 0) {
            answeredCount++; // Sliders always count
        } else if (toggles.length > 0) {
            // Toggles are binary but count as answered if interactive, 
            // or strictly if they changed from default? 
            // For this UI, let's assume they are always "answered" as they have a default state.
            answeredCount++;
        }
    });

    const counterEl = document.getElementById(`count-${step}`);
    if(counterEl) counterEl.innerText = `Answered: ${answeredCount} / ${questions.length}`;
}

function updateProgress() {
    const form = document.getElementById('quizForm');
    const totalQuestions = 42;
    
    // Count unique names checked
    const data = new FormData(form);
    let count = 0;
    // Fix: count maps directly to unique questions if inputs are named correctly
    // Since FormData might include multiple values for checkboxes, we use a Set
    const uniqueQuestions = new Set();
    
    for(let pair of data.entries()) {
        // exclude textareas or extra fields, count unique keys (questions)
        if(!pair[0].includes('_notes') && !pair[0].includes('-val')) {
             uniqueQuestions.add(pair[0]);
        }
    }

    const percent = Math.min(100, Math.round((uniqueQuestions.size / totalQuestions) * 100));
    
    document.getElementById('progressBar').style.width = percent + '%';
    document.getElementById('percent-indicator').innerText = percent + '% Complete';
}