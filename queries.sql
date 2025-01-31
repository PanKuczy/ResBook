--Add a Resource if Not Exists
WITH new_resource AS (
    INSERT INTO resources (title, subtitle, authors, publication_year, place, cover_url, resource_type, isbn, doi)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (isbn) DO NOTHING
    RETURNING id
)
INSERT INTO user_resources (user_id, resource_id)
VALUES ($1, COALESCE(
    (SELECT id FROM new_resource), 
    (SELECT id FROM resources WHERE isbn = ($2))
));

--Retrieve All Resources Added by a Specific User
SELECT r.*
FROM resources r
JOIN user_resources ur ON r.id = ur.resource_id
WHERE ur.user_id = 1;

--Retrieve All Resources Added by a Specific User with their categories
SELECT r.*, 
       STRING_AGG(c.name, ', ') AS categories
FROM resources r
JOIN user_resources ur ON r.id = ur.resource_id
LEFT JOIN resource_categories rc ON r.id = rc.resource_id
LEFT JOIN categories c ON rc.category_id = c.id
WHERE ur.user_id = 1
GROUP BY r.id;

--Add a new note with certain tags
INSERT INTO notes (user_id, resource_id, note_text, target_pages, target_object)
VALUES ($1, $2, $3, $4, $5)
RETURNING id AS note_id, note_text, created_at, updated_at, target_pages, target_object;
--Addssign tags to that note
INSERT INTO note_tags (note_id, tag_id)
SELECT $1, unnest(string_to_array($2, ',')::int[]);

--Add a Tag
INSERT INTO tags (name, user_id)
VALUES ('Research', 1), ('Urgent', 1)
ON CONFLICT (name, user_id) DO NOTHING; -- Prevent duplicates for the same user

--Add a Category
INSERT INTO categories (name, user_id)
VALUES ($1, $2)
ON CONFLICT (name, user_id) DO NOTHING -- Prevent duplicates for the same user
RETURNING id; 

--Link a Tag to a Note
INSERT INTO note_tags (note_id, tag_id)
VALUES (1, 1), (1, 2);

--Link a Category to a Resource
INSERT INTO resource_categories (resource_id, category_id)
VALUES (<resource_id>, <category_id>);

--Query Categories for a Specific User
SELECT id, name
FROM categories
WHERE user_id = ($1);

--Query Tags for a Specific User
SELECT id, name, color
FROM tags
WHERE user_id = ($1);

--Query Tags and Notes join table
SELECT *
FROM note_tags;

--Query Notes for a Specific User
SELECT *
FROM notes
WHERE user_id = ($1);


--Query Notes with a Specific Tag
SELECT n.id, n.note_text
FROM notes n
JOIN note_tags nt ON n.id = nt.note_id
JOIN tags t ON nt.tag_id = t.id
WHERE t.name = 'Research' AND t.user_id = 1;

--Query Resources in a Specific Category
SELECT r.id, r.title
FROM resources r
JOIN resource_categories rc ON r.id = rc.resource_id
JOIN categories c ON rc.category_id = c.id
WHERE c.name = ($1) AND c.user_id = ($2);

--Super Query for all user resources with categories with notes with tags
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
    

-- BACKUP SUPER QUERY 2025.01.31
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
