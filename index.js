import express from "express";
import pg from "pg";
import bodyParser from "body-parser";
import ejs from "ejs";
import argon2 from "argon2";
import axios from "axios";
import util, { inspect } from "util";


//CONSTANTS
const port = 3000;

const app = express();
const db = new pg.Client({
    user: "postgres",
    password: "d4ta8@5e",
    host: "localhost",
    database: "resbook",
    port: 5432
});
app.use(express.json());

let userState = "logged";
let currentUserId = 1;
let userResourcesFull = {};
let globalHelperData = {};


//FUNCTIONS
// passwords func defs
async function hashPassword(password) {
    try {
        // Hash the password with Argon2
        const hash = await argon2.hash(password, {
            type: argon2.argon2id, // Use Argon2id (recommended variant)
            memoryCost: 2 ** 16,  // Memory cost in kibibytes (64 MiB)
            timeCost: 3,          // Time cost (iterations)
            parallelism: 1        // Degree of parallelism
        });
        console.log('Hashed Password:', hash);
        return hash;
    } catch (err) {
        console.error('Error hashing password:', err);
    }
}

async function verifyPassword(password, hash) {
    try {
        // Verify the password against the hash
        const isValid = await argon2.verify(hash, password);
        if (isValid) {
            console.log('Password is correct!');
        } else {
            console.log('Invalid password!');
        }
    } catch (err) {
        console.error('Error verifying password:', err);
    }
}

//passwords calls
(async () => {
    const password = 'dupa666';

    // Hash the password
    // const hashedPassword = await hashPassword(password);

    // Verify the password
    // await verifyPassword(password, hashedPassword); // Should print "Password is correct!"

    // Test with an incorrect password
    // await verifyPassword('wrong_password', hashedPassword); // Should print "Invalid password!"
})();


function appendInvertedColor (tag) {
    const regex = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/;
    const result = tag.color.match(regex);
    if (result) {
        const colorSum = parseInt(result[1], 10) + parseInt(result[2], 10) + parseInt(result[3], 10);
        if (colorSum>382){
            tag.invertColor =  `hsl(from ${tag.color} h calc(s + 15) calc(l - 35))`;
        } else {
            tag.invertColor =  `hsl(from ${tag.color} h 100 calc(l + 35))`;
        }
    } else {
        throw new Error("Invalid RGB string");
    }
}

function dateFormat(item){
    if (item.created_at != null){
    const dateIso = new Date(item.updated_at ?? item.created_at);
    const formattedDate = dateIso.getFullYear() + '-' +
                          String(dateIso.getMonth() + 1).padStart(2, '0') + '-' +
                          String(dateIso.getDate()).padStart(2, '0') + ' ' +
                          String(dateIso.getHours()).padStart(2, '0') + ':' +
                          String(dateIso.getMinutes()).padStart(2, '0');
    item.formattedDate = formattedDate;
    }                   
}

function appendToDataTree(existingObject, objectToBeAdded) {
    if (!Array.isArray(existingObject)) {
        existingObject = Object.values(existingObject);
    }
    existingObject.push(objectToBeAdded);
    // IMPORTANT: reassign the updated array back to the resource
    return(existingObject);
}


db.connect();


///xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
async function getAllData () {
const resultUsers = await db.query("select * from users where id=($1)", [currentUserId]);
const superQuery = `
SELECT 
    r.id AS resource_id,
    r.title AS resource_title,
    r.authors,
    r.resource_type,
    r.isbn,
    r.doi,
    r.created_at AS resource_created_at,
    r.subtitle,
    r.place,
    r.cover_url,
    r.publication_year,
    STRING_AGG(DISTINCT c.name, ', ') AS resource_categories,
    json_agg(
        DISTINCT jsonb_build_object(
            'note_id', n.id,
            'note_text', n.note_text,
            'created_at', n.created_at,
            'updated_at', n.updated_at,
            'target_pages', n.target_pages,
            'target_object', n.target_object,
            'tags', nt.tags
        )
    ) AS notes
FROM resources r
JOIN user_resources ur ON r.id = ur.resource_id
LEFT JOIN resource_categories rc ON r.id = rc.resource_id
LEFT JOIN categories c ON rc.category_id = c.id
LEFT JOIN notes n ON n.resource_id = r.id AND n.user_id = ur.user_id
LEFT JOIN (
    SELECT 
        nt.note_id, 
        STRING_AGG(t.name, ', ') AS tags
    FROM note_tags nt
    JOIN tags t ON nt.tag_id = t.id
    GROUP BY nt.note_id
) nt ON n.id = nt.note_id
WHERE ur.user_id = $1
GROUP BY r.id;
`;

// const resultUserResources = await db.query("SELECT r.* FROM resources r JOIN user_resources ur ON r.id = ur.resource_id WHERE ur.user_id = ($1)", [currentUserId]);
const resultUserResources = await db.query(superQuery, [currentUserId]);
// console.log(resultUserResources.rows);
// console.log(util.inspect(resultUserResources.rows, { depth: null, colors: true }));

const queryCategories = `
SELECT id, name
FROM categories
WHERE user_id = ($1);
`;
const resultUserCategories = await db.query(queryCategories,[currentUserId]);

const queryTags = `
SELECT id, name, color
FROM tags
WHERE user_id = ($1);
`
const queryNotesTagsCorelation =`
SELECT *
FROM note_tags;`
const resultNotesTagsCorelation = await db.query(queryNotesTagsCorelation);

const resultUserTags = await db.query(queryTags, [currentUserId]);

const queryNotes = `
SELECT *
FROM notes
WHERE user_id = ($1);
`;
const resultUserNotes = await db.query(queryNotes,[currentUserId]);

const data = {
    user: resultUsers.rows[0].username,
    resources: resultUserResources.rows,
    categories: resultUserCategories.rows,
    tags: resultUserTags.rows,
    notes: resultUserNotes.rows,
    notes_tags_corel: "",
    showElement: false
};
globalHelperData = {
    notesTagsCorel: resultNotesTagsCorelation.rows,
};

// return userResourcesFull;
// console.log("TAGS PRE FUNCTION: ", data.tags);
data.tags.forEach(element => {
    appendInvertedColor(element);
});
data.notes.forEach(note => {
    dateFormat(note);
});
data.resources.forEach(resource => {
    if (resource.notes.length > 0){ 
        resource.notes.forEach(note => {
        dateFormat(note);
    })};
});
userResourcesFull = data;
return data;
}
///xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx


app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

//GET BOOK FROM OPENLIBRARY
const itemType = "ISBN";

// const itemNumber = "9781800643451";
const itemNumber = "0860547051";
// const itemNumber = "9788323540991";
// const queryUrl = `https://openlibrary.org/api/books?bibkeys=${itemType}:${itemNumber}&jscmd=data&format=json`;

// try {
//     const getBookOL = await axios.get(queryUrl);
//     const resultSubData = getBookOL.data[`${itemType}:${itemNumber}`];
//     const bookData = {
//         title: resultSubData?.title,
//         subtitle: resultSubData?.subtitle ?? null,
//         publication_year: resultSubData?.publish_date ?? null,
//         place: resultSubData?.publish_places?.[0]?.name ?? null,
//         cover_url: resultSubData.cover?.medium ?? null
//     };
//     let authorsArray = [];
//     for (let i = 0; i < resultSubData.authors.length; i++) {
//         authorsArray.push(resultSubData.authors[i].name);
//         if (i===3){
//             authorsArray[3] = "et. al";
//             break
//         }
//     }
//     bookData.authors = authorsArray.join(", ");
//     console.log(bookData);
// } catch (error) {
//     console.log(error);
// }


app.get("/", async (req, res) => {
    const data = await getAllData();
    res.render("index.ejs", data);

});

app.get("/resource/:id", async (req,res) =>{
    const request = req.params.id;
    // console.log("BEFORE", userResourcesFull);
    const specificResource = userResourcesFull.resources.filter(resource => resource.resource_id == request);
    // console.log("SPECIFIC RESOURCE", specificResource);
    // userResourcesFull.resources = userResourcesFull.resources;
    const data = { ...userResourcesFull, resources: specificResource};
    data.notes_tags_corel = globalHelperData.notesTagsCorel;
    data.showElement = true;
    // console.log("AFTER", data);
    // console.log("AFTER", util.inspect(data, { depth: null, colors: true }));
    // console.log("GLOBAL HELPER DATA", globalHelperData);
    // const tagIds = data.notes_tags_corel.filter((id) => id.note_id == data.notes[0].id)[0].tag_id;
    // console.log("note tags", tagIds);
    res.render("index.ejs", data)
});

//STARE add note
//xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
// app.post("/add-note", async (req, res) =>{
//     const request = req.body.resource_id;
//     console.log("new add note request");

//     const queryNewNote = `
//     INSERT INTO notes (user_id, resource_id, note_text, target_pages, target_object)
//     VALUES ($1, $2, $3, $4, $5)
//     RETURNING id AS note_id, note_text, created_at, updated_at, target_pages, target_object;
//     `
//     const queryAssignTags =`
//     INSERT INTO note_tags (note_id, tag_id)
//     SELECT $1, unnest(string_to_array($2, ',')::int[]);
//     `
//     const resultNewNote = await db.query(queryNewNote,[currentUserId, request, req.body.note_text, req.body.target_pages, req.body.target_object]);
//     const newNote = resultNewNote.rows[0];
//     dateFormat(newNote);
    
//     const resultAssignTags = await db.query(queryAssignTags,[newNote.note_id, req.body.selectedTags]);

//     const queryNotesTagsCorelation =`
//     SELECT *
//     FROM note_tags;`
//     const resultNotesTagsCorelation = await db.query(queryNotesTagsCorelation);
//     globalHelperData = {
//         notesTagsCorel: resultNotesTagsCorelation.rows,
//     };

//     //-------- tagi
//     const newNoteTagsIds = req.body.selectedTags.split(',').map(item => Number(item.trim()));
//     const newNoteTagsNames = [];
//     newNoteTagsIds.forEach(id =>{
//         const tagname = userResourcesFull.tags.find((tagobj) => tagobj.id == id).name;
//         newNoteTagsNames.push(tagname);
//     });;
//     // console.log("All tags: ", userResourcesFull.tags);
//     // console.log("New note tags IDs: ", newNoteTagsIds);
//     // console.log("New note tags: " ,newNoteTagsNamesString);
//     newNote.tags = newNoteTagsNames.join();
//     console.log("Created note: ", newNote);
//     const specificResource = userResourcesFull.resources.filter(resource => resource.resource_id == request);
//     let specificResourceNotesUpdated = appendToDataTree(specificResource[0].notes, newNote);
//     specificResource[0].notes = specificResourceNotesUpdated;
//     // Check results
//     //   console.log("Updated resource notes:", specificResource[0].notes);

//     //----- tagi koniec

//     const data = { ...userResourcesFull, resources: specificResource};
//     data.notes_tags_corel = globalHelperData.notesTagsCorel;
//     data.showElement = true;
//     // console.log("SPECIFIC RESOURCE", util.inspect(specificResource, { depth: null, colors: true }));
//     // console.log("SPECIFIC RESOURCE", specificResource);

//     res.render("index.ejs", data);
// });
//xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

app.post("/add-note", async (req, res) =>{
    const resourceId = req.body.resource_id;
    console.log("new add note request");

    const queryNewNote = `
    INSERT INTO notes (user_id, resource_id, note_text, target_pages, target_object)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id AS note_id, note_text, created_at, updated_at, target_pages, target_object;
    `
    const queryAssignTags =`
    INSERT INTO note_tags (note_id, tag_id)
    SELECT $1, unnest(string_to_array($2, ',')::int[]);
    `
    const resultNewNote = await db.query(queryNewNote,[currentUserId, resourceId, req.body.note_text, req.body.target_pages, req.body.target_object]);
    const newNote = resultNewNote.rows[0];
    const resultAssignTags = await db.query(queryAssignTags,[newNote.note_id, req.body.selectedTags]);

    const data = await getAllData();

    res.redirect(`/resource/${resourceId}`);
});


// STARE DELETE
// app.post("/delete-note", async (req,res)=>{
//     const resourceId = req.body.resource_id;
//     const queryDeleteNote = `
//     DELETE 
//     FROM notes 
//     WHERE id=$1
//     `;
//     const deleteResult = await db.query(queryDeleteNote,[req.body.item_id]);

//     const data = await getAllData();

//     res.redirect(`/resource/${resourceId}`);

// });

app.post("/delete-note", async (req,res) => {
    try {
        const queryDeleteNote = `
        DELETE 
        FROM notes 
        WHERE id=$1
        `;
        await db.query(queryDeleteNote,[req.body.item_id]);
        res.json({ success: true, itemId: req.body.item_id });
      } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Error deleting item' });
      }
    res.status(200);
});


// db.end();
app.listen(port, () =>  {
    console.log("Local server running on port: ", port);
});

// console.log(util.inspect(zmienna, { depth: null, colors: true }));