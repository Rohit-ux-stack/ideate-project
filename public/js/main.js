// Function to toggle modal visibility
function toggleModal() {
    const modal = document.getElementById('postModal');
    modal.classList.toggle('hidden');
    modal.classList.toggle('flex');
}

// Close modal if user clicks outside the form
window.onclick = function(event) {
    const modal = document.getElementById('postModal');
    if (event.target == modal) {
        toggleModal();
    }
}