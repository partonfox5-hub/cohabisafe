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

// ... (Keep existing validateStep, updateSliderLabel, toggleText, event listeners) ...

function toggleText(elementId, show) {
    const el = document.getElementById(elementId);
    if(el) {
        el.style.display = show ? 'block' : 'none';
        if (!show) el.value = "";
    }
    updateProgress();
}