-- Add Scheme of Work & Lesson Planning models

-- BLOB guard — skip if already applied
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scheme_of_work') THEN
    RETURN;
  END IF;

-- Scheme of Work — a teacher's termly plan for a subject/class
CREATE TABLE "scheme_of_work" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "school_id" TEXT NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "class_id" TEXT NOT NULL,
    "term_id" TEXT NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP,
    "rejection_reason" VARCHAR(500),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fk_scheme_school" FOREIGN KEY ("school_id") REFERENCES "School"("id"),
    CONSTRAINT "fk_scheme_class" FOREIGN KEY ("class_id") REFERENCES "Class"("id"),
    CONSTRAINT "fk_scheme_term" FOREIGN KEY ("term_id") REFERENCES "AcademicTerm"("id"),
    CONSTRAINT "fk_scheme_creator" FOREIGN KEY ("created_by_id") REFERENCES "User"("id"),
    CONSTRAINT "fk_scheme_approver" FOREIGN KEY ("approved_by_id") REFERENCES "User"("id")
);

CREATE INDEX "idx_scheme_school_status" ON "scheme_of_work"("school_id", "status");
CREATE INDEX "idx_scheme_school_class_subject" ON "scheme_of_work"("school_id", "class_id", "subject");
CREATE INDEX "idx_scheme_school_term" ON "scheme_of_work"("school_id", "term_id");
CREATE INDEX "idx_scheme_creator" ON "scheme_of_work"("created_by_id");

-- Scheme Week — one week of a scheme
CREATE TABLE "scheme_week" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheme_id" TEXT NOT NULL,
    "week_number" INTEGER NOT NULL,
    "topic" VARCHAR(300) NOT NULL,
    "objectives" TEXT,
    "teaching_methods" VARCHAR(500),
    "resources" VARCHAR(500),
    "assessment" VARCHAR(500),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fk_week_scheme" FOREIGN KEY ("scheme_id") REFERENCES "scheme_of_work"("id") ON DELETE CASCADE,
    CONSTRAINT "uq_week_scheme_number" UNIQUE ("scheme_id", "week_number")
);

CREATE INDEX "idx_scheme_week_scheme" ON "scheme_week"("scheme_id");

-- Lesson Plan — daily plan for a specific week/day
CREATE TABLE "lesson_plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheme_week_id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "topic" VARCHAR(300) NOT NULL,
    "objectives" TEXT,
    "introduction" TEXT,
    "main_activity" TEXT,
    "conclusion" TEXT,
    "materials" VARCHAR(500),
    "homework" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "completed_at" TIMESTAMP,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fk_lesson_week" FOREIGN KEY ("scheme_week_id") REFERENCES "scheme_week"("id") ON DELETE CASCADE,
    CONSTRAINT "uq_lesson_week_day" UNIQUE ("scheme_week_id", "day_of_week")
);

CREATE INDEX "idx_lesson_plan_week" ON "lesson_plan"("scheme_week_id");

END $$;
