function loadCheck() {
    console.log("scripts loaded!");
}

function sumRGB(rgbString) {
    const regex = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/;
    const result = rgbString.match(regex);

    if (result) {
        return parseInt(result[1], 10) + parseInt(result[2], 10) + parseInt(result[3], 10);
        console.log(parseInt(result[1], 10) + parseInt(result[2], 10) + parseInt(result[3], 10));
    } else {
        throw new Error("Invalid RGB string");
    }
}

// Example usage:
// const rgbString = "rgb(255, 20, 147)";
// const sum = sumRGB(rgbString);
// console.log(sum); // 422

