let currentStep = 1;
const totalSteps = 5;

document.addEventListener('DOMContentLoaded', () => {
    updateProgress();
    updateSectionProgress(currentStep);
    showStep(currentStep);
    
    // Initialize slider labels
    document.querySelectorAll('.styled-slider').forEach(slider => {
        updateSliderLabel(slider);
        slider.addEventListener('input', () => updateSliderLabel(slider));
    });
});

function showStep(step) {
    document.querySelectorAll('.quiz-step').forEach(el => el.style.display = 'none');
    document.getElementById(`step-${step}`).style.display = 'block';
    
    document.getElementById('prevBtn').style.display = step === 1 ? 'none' : 'inline-block';
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

function changeStep(n) {
    const currentStepDiv = document.getElementById(`step-${currentStep}`);
    const errorMsg = document.getElementById('error-msg');

    if (n === 1 && !validateStep(currentStepDiv)) {
        errorMsg.style.display = 'block';
        return; 
    }
    
    errorMsg.style.display = 'none';
    currentStep += n;
    showStep(currentStep);
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
        // Sliders default to 5, so they are strictly always "answered" unless we force movement
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
        
        if (radios.length > 0) {
            if (Array.from(radios).some(r => r.checked)) answeredCount++;
        } else if (sliders.length > 0) {
            answeredCount++; // Sliders always count
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
    for(let pair of data.entries()) {
        // exclude textareas or extra fields, count unique keys (questions)
        if(!pair[0].includes('_notes')) count++; 
    }
    
    // Fix: count maps directly to unique questions if inputs are named correctly
    // Since FormData might include multiple values for checkboxes, we use a Set
    const uniqueQuestions = new Set(data.keys());
    // Remove non-question keys if any
    uniqueQuestions.delete('o4_notes'); 
    
    const percent = Math.min(100, Math.round((uniqueQuestions.size / totalQuestions) * 100));
    
    document.getElementById('progressBar').style.width = percent + '%';
    document.getElementById('percent-indicator').innerText = percent + '% Complete';
}