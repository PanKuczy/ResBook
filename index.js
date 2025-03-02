import express from "express";
import fs from "fs";
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
app.use(express.json({ limit: '10mb' }));

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
    if (item.created_at != null || item.updated_at != null){
    const dateIso = new Date(item.updated_at ?? item.created_at);
    const formattedDate = dateIso.getFullYear() + '-' +
                          String(dateIso.getMonth() + 1).padStart(2, '0') + '-' +
                          String(dateIso.getDate()).padStart(2, '0') + ' ' +
                          String(dateIso.getHours()).padStart(2, '0') + ':' +
                          String(dateIso.getMinutes()).padStart(2, '0');
    item.formattedDate = formattedDate;
    }                   
}

function filterData(sourceData, filteringValues, sourcePropertyName) {
    // sourceData - z dużego obiektu jakaś gałąź zawierająca obiekty, np. data.tags
    // filteringValues - array (lub string z wartościami oddzielonymi przecinkami) z danymi wg. których mamy filtrować, np. idsy tagów lub ich nazwy
    // sourcePropertyName - właściwość do porównania, np. tag_id, tag_name

    let filtersArray = [];
    // transform filterData to array if it's a string
    if (!Array.isArray(filteringValues)) {
        filtersArray = JSON.parse('['+filteringValues.replace(/(^|,)\s*([^,]*[^0-9, ][^,]*?)\s*(?=,|$)/g,'$1"$2"')+']');
    } else {
        filtersArray = [...filteringValues];
    }
    // console.log("All data to be filtered =", sourceData);
    // console.log("filterArray =", filtersArray);

    // filtering function
    let filteredData = sourceData.filter(item => filtersArray.includes(item[sourcePropertyName]));
    // console.log("Filtered data =", filteredData);
    return filteredData;
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


//xxxxxxxxxxxxx SUPER QUERY ALL xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
async function getAllData () {
    const resultUsers = await db.query("select * from users where id=($1)", [currentUserId]);
    const superQuery = `
    SELECT 
        r.user_id,
        r.id AS resource_id,
        r.title AS resource_title,
        r.authors,
        r.resource_type,
        r.reference_number,
        r.created_at AS resource_created_at,
        r.subtitle,
        r.place,
        r.cover_url,
        r.publication_year,
        json_agg(
            DISTINCT jsonb_build_object(
                'category_id', c.id,
                'category_name', c.name
            )
        ) AS resource_categories,
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
    LEFT JOIN resource_categories rc ON r.id = rc.resource_id
    LEFT JOIN categories c ON rc.category_id = c.id
    LEFT JOIN notes n ON n.resource_id = r.id AND n.user_id = r.user_id
    LEFT JOIN (
        SELECT 
            nt.note_id, 
            STRING_AGG(t.name, ', ') AS tags
        FROM note_tags nt
        JOIN tags t ON nt.tag_id = t.id
        GROUP BY nt.note_id
    ) nt ON n.id = nt.note_id
    WHERE r.user_id = $1
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
        notes_tags_corel: resultNotesTagsCorelation.rows
    };
    globalHelperData = {
        notesTagsCorel: resultNotesTagsCorelation.rows,
    };

    // return userResourcesFull;
    // console.log("TAGS PRE FUNCTION: ", data.tags);
    data.tags.forEach(element => {
        appendInvertedColor(element);
    });

    // add assigned tag objects under each note under each resource (only on data.resources.notes and not on data.notes)
    data.resources.forEach(resObj => {
        resObj.notes.forEach(noteObj => {
            const filteredTagIds = resultNotesTagsCorelation.rows.filter((row) => row.note_id == noteObj.note_id).map(({note_id, tag_id}) => (tag_id));
            const filteredTagObjects = filterData(data.tags, filteredTagIds, 'id');
            noteObj.tags_objects = filteredTagObjects;
        });
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
    console.log(util.inspect(data, { depth: null, colors: true }));
    userResourcesFull = data;
    return data;
}
//xxxxxxxxxxxxx SUPER QUERY ALL END xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx


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


// MAIN GET ROUTE
app.get("/", async (req, res) => {
    const data = await getAllData();
    res.render("index.ejs", data);
});


//ADD CATEGORY
app.post("/add-category", async (req,res) => {
    const request = req.body;
    // console.log("Add category request :",request);
    try {
        const queryNewCategory =`
        INSERT INTO categories (name, user_id)
        VALUES ($1, $2)
        ON CONFLICT (name, user_id) DO NOTHING -- Prevent duplicates for the same user
        RETURNING id; 
        `;

        const resultNewCategory = await db.query(queryNewCategory, [request.newCategoryName, currentUserId]);

        const newCategory = {
        name: request.newCategoryName,
        id: resultNewCategory.rows[0].id
        };

        // console.log("New Category object :",newCategory);
        res.status(200).json({ success: true, newCategory });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Error adding category' });
    }
});

//EDIT CATEGORIES
app.put("/edit-categories", async (req, res) => {
    // console.log(req.body);
    try {
        const requestCategories = req.body;
        // Start building the query
        const queryUpdateCategories = `
            UPDATE categories
            SET name = CASE
                ${requestCategories.map((category, index) => `
                    WHEN id = $${index * 2 + 1} THEN $${index * 2 + 2}
                `).join('')}
            END
            WHERE id IN (${requestCategories.map((category, index) => `$${index * 2 + 1}`).join(', ')});
        `;

        // Flatten the values array
        const values = requestCategories.flatMap((category) => [category.id, category.name]);

        // Execute the batch update query
        await db.query(queryUpdateCategories, values);

        res.status(200).json({ success: true});
    } catch (error) {
        console.error(err);
    }
});


//ASSIGN CATEGORY TO RESOURCE
app.post("/assign-category", async (req,res) =>{
    const request = req.body;
    console.log("assign category request", request);
    try {
        const queryAssignCategory = `
        INSERT INTO resource_categories (resource_id, category_id)
        VALUES ($1, $2)
        `;
        await db.query(queryAssignCategory,[request.resource_id, request.id]);
        res.status(200).json({success: true});
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Error assigning category' });
    }
});

//REMOVE CATEGORY FROM RESOURCE
app.post("/strip-category", async (req,res) =>{
    const request = req.body;
    console.log("strip category request", request);
    try {
        const queryStripCategory = `
        DELETE FROM resource_categories
        WHERE resource_id = $1 AND category_id = $2;
        `;
        await db.query(queryStripCategory,[request.resource_id, request.category_id]);
        res.status(200).json({success: true});
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Error assigning category' });
    }
});


//EDIT RESOURCE
app.put("/edit-resource", async (req, res) => {
    // console.log(req.body);
    // save image to server and add url to data
    let coverPath = null;
    if (req.body.cover_base64) {
        // Remove the data URI prefix (e.g., "data:image/jpeg;base64,")
        const base64Data = req.body.cover_base64.replace(/^data:image\/\w+;base64,/, '');

        // Convert the base64 string back into a binary buffer
        const buffer = Buffer.from(base64Data, 'base64');

        // Write the buffer to a file (e.g., "image.jpg")
        const coverPathBackEnd = `public/assets/covers/res_${req.body.resource_id}_cover.jpg`;
        coverPath = `assets/covers/res_${req.body.resource_id}_cover.jpg`;
        fs.writeFile(coverPathBackEnd, buffer, (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error saving cover image.');
            }
        });
    }
    // postgres
    try {
        const queryEditRes = `
            UPDATE resources
            SET title = $1, subtitle = $2, authors = $3, resource_type = $4, place = $5, publication_year = $6, reference_number = $7, cover_url = COALESCE($8, cover_url)
            WHERE id = $9
        `;
        await db.query(queryEditRes,[req.body.resource_title, req.body.resource_subtitle, req.body.authors, req.body.resource_type, req.body.place, req.body.publication_year, req.body.reference_number, coverPath, req.body.resource_id]);
        res.status(200).json({success: true});
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Error editing resource' });
    }
});


// ADD TAG
app.post("/add-new-tag", async (req,res) =>{
    // console.log(req.body);
    try {
        const queryNewTag = `
        INSERT INTO tags (name, user_id, color)
        VALUES ($1, $2, $3)
        RETURNING id;
        `;
        const queryNewTagResult = await db.query(queryNewTag,[req.body.name, currentUserId, req.body.color]);
        res.status(200).json({success: true, id: queryNewTagResult.rows[0].id});
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Error adding new tag' });
    }
});

// ASSIGN TAG TO NOTE
app.post("/assign-tags", async (req, res) => {
    // console.log("Assign tags request: ", req.body);
    try {
        const tagIdsInt = req.body.tags_ids.map(Number); // conversion is needed bc the array from the request is an array of strings eg. '1', '2'...
        const queryClearTags = `
            DELETE FROM note_tags
            WHERE note_id = $1;
        `;
        const queryAssignTags = `
            INSERT INTO note_tags (note_id, tag_id)
            SELECT $1, unnest($2::int[]);
        `;
        await db.query(queryClearTags, [req.body.note_id]);
        await db.query(queryAssignTags, [req.body.note_id, tagIdsInt]);
        
        const allData = await getAllData();
        const tagsObjects = allData.resources.find((resource) => resource.resource_id == req.body.resource_id).notes.find((note) => note.note_id == req.body.note_id).tags_objects;
        console.log("tags:", tagsObjects);
        res.status(200).json({success: true, tags_obj: tagsObjects});
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Error assigning tags' });
    }
});

// EDIT TAGS
app.put("/edit-tags", async (req, res) =>{
    // console.log("Edit tags request :", req.body);
    try {
        const requestTags = req.body;
        const queryUpdateTags = `
            UPDATE tags
            SET 
                name = CASE
                    ${requestTags.map((tag, index) => `
                        WHEN id = $${index * 3 + 1} THEN $${index * 3 + 2}
                    `).join('')}
                END,
                color = CASE
                    ${requestTags.map((tag, index) => `
                        WHEN id = $${index * 3 + 1} THEN $${index * 3 + 3}
                    `).join('')}
                END
            WHERE id IN (${requestTags.map((tag, index) => `$${index * 3 + 1}`).join(', ')});
        `;
        // Flatten the values array
        const values = requestTags.flatMap((tag) => [
            tag.tag_id,
            tag.tag_name,
            tag.tag_color
        ]);

        await db.query(queryUpdateTags, values);
        res.status(200).json({ success: true});
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Error editing tags' });
    }
});

//NOWE ADD-NOTE Z RES.JSON
app.post("/add-note", async (req, res) =>{
    const resourceId = req.body.resource_id;
    // console.log("new add note request", req.body);
    try {
        const queryNewNote = `
        INSERT INTO notes (user_id, resource_id, note_text, target_pages, target_object)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id AS note_id, resource_id, note_text, created_at, updated_at, target_pages, target_object;
        `
        const queryAssignTags =`
        INSERT INTO note_tags (note_id, tag_id)
        SELECT $1, unnest(string_to_array($2, ',')::int[]);
        `
        const resultNewNote = await db.query(queryNewNote,[currentUserId, resourceId, req.body.note_text, req.body.target_pages, req.body.target_object]);
        let newNote = resultNewNote.rows[0];
        // console.log("newNote zaraz po wyslaniu do db wraz z returning :", newNote);
        // const resultAssignTags = await db.query(queryAssignTags,[newNote.note_id, req.body.selectedTags]);
        try {
            await db.query(queryAssignTags,[newNote.note_id, req.body.selectedTagIds]);
        } catch (err) {
            console.error(err);
        }
        
        newNote.tag_ids = req.body.selectedTagIds;
        newNote.tag_names = req.body.selectedTagsNames;
        dateFormat(newNote);
        // console.log("new note after database query and date format: ", newNote);
        
        const data = await getAllData();

        // Append selected tags full objects
        let selectedTagsObjects = filterData(data.tags, newNote.tag_ids, "id");
        newNote.selectedTags = selectedTagsObjects;

        // console.log("New note after all", newNote);
        res.status(200).json({ success: true, newNote});
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Error adding note' });
    }
});

// EDIT NOTE
app.put("/edit-note", async (req,res) =>{
    // console.log(req.body);
    try {
        const requestNote = req.body;
        const queryUpdateNote = `
            UPDATE notes
            SET note_text = $1, target_object = $2, target_pages = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING updated_at;
        `;
        const noteUpdateResult = await db.query(queryUpdateNote,[requestNote.note_text, requestNote.note_link, requestNote.note_pages, requestNote.note_id]);
        const resultData = noteUpdateResult.rows[0];
        dateFormat(resultData);
        // console.log(resultData);
        res.status(200).json({success: true, resultData});
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Error editing note' });
    }

});


//DELETE

app.post("/delete-resource", async (req,res) => {
    console.log("Delete resource request: ", req.body);
    try {
        const queryDeleteResource = `
            DELETE
            FROM resources
            WHERE id=$1
        `;
        await db.query(queryDeleteResource, [req.body.resource_id]);
        // remove cover if exists
        const coverPathBackEnd = `public/assets/covers/res_${req.body.resource_id}_cover.jpg`;
        fs.rm(coverPathBackEnd, (err) => {
            if (err) {
                console.log("No cover found");
            }
        });
        res.status(200).json({success: true});
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Error deleting resource' });
      }

});

app.post("/delete-note", async (req,res) => {
    try {
        const queryDeleteNote = `
        DELETE 
        FROM notes 
        WHERE id=$1
        `;
        await db.query(queryDeleteNote,[req.body.item_id]);
        res.status(200).json({ success: true, itemId: req.body.item_id });
      } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Error deleting item' });
      }
});

app.post("/delete-category", async (req,res) => {
    const request = req.body;
    console.log("Delete category request: ", request);

    try {
        const queryDeleteCategory = `
        DELETE 
        FROM categories 
        WHERE id=$1
        `;
        await db.query(queryDeleteCategory,[req.body.item_id]);
        res.status(200).json({ success: true, itemId: req.body.item_id });
      } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Error deleting item' });
      }
});

app.post("/delete-tag", async (req, res) =>{
    console.log("Delete tag request " , req.body);
    try {
        const queryDeleteTag =`
        DELETE FROM tags
        WHERE id=$1
        `;
        await db.query(queryDeleteTag,[req.body.item_id]);
        res.status(200).json({success: true});
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Error deleting item' });
      }
});

// db.end();
app.listen(port, () =>  {
    console.log("Local server running on port: ", port);
});

// console.log(util.inspect(zmienna, { depth: null, colors: true }));