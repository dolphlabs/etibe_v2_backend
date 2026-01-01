import { Document, Model, UpdateQuery, Types } from "mongoose";
import {
  PaginatedResult,
  PaginationMeta,
  QueryOptions,
  PopulateOptions,
} from "../../shared/types";
import { APP_CONSTANTS } from "../../shared/constants";
import { calculatePagination } from "../../shared/utils";

export type FilterQuery<T> = Partial<T> & Record<string, unknown>;

export abstract class BaseRepository<T extends Document> {
  constructor(protected readonly model: Model<T>) {}

  async create(data: Partial<T>): Promise<T> {
    const createdDocument = new this.model(data);
    return createdDocument.save();
  }

  async createMany(data: Partial<T>[]): Promise<T[]> {
    return this.model.insertMany(data) as unknown as T[];
  }

  async findById(
    id: string | Types.ObjectId,
    options?: Pick<QueryOptions, "select" | "populate">
  ): Promise<T | null> {
    const filter = {
      _id: new Types.ObjectId(id.toString()),
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = this.model.findOne(filter as any);

    if (options?.select) {
      query = query.select(options.select.join(" "));
    }

    if (options?.populate) {
      query = this.applyPopulate(query, options.populate);
    }

    const result = await query.lean().exec();
    return result as T | null;
  }

  async findOne(
    filter: FilterQuery<T>,
    options?: Pick<QueryOptions, "select" | "populate">
  ): Promise<T | null> {
    const queryFilter = {
      ...filter,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = this.model.findOne(queryFilter as any);

    if (options?.select) {
      query = query.select(options.select.join(" "));
    }

    if (options?.populate) {
      query = this.applyPopulate(query, options.populate);
    }

    const result = await query.lean().exec();
    return result as T | null;
  }

  async findAll(
    filter: FilterQuery<T> = {} as FilterQuery<T>,
    options?: Omit<QueryOptions, "page" | "limit">
  ): Promise<T[]> {
    const queryFilter = {
      ...filter,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = this.model.find(queryFilter as any);

    if (options?.select) {
      query = query.select(options.select.join(" "));
    }

    if (options?.sort) {
      query = query.sort(options.sort);
    }

    if (options?.populate) {
      query = this.applyPopulate(query, options.populate);
    }

    const result = await query.lean().exec();
    return result as T[];
  }

  async findAllWithPagination(
    filter: FilterQuery<T> = {} as FilterQuery<T>,
    options: QueryOptions = {}
  ): Promise<PaginatedResult<T>> {
    const page = options.page ?? APP_CONSTANTS.DEFAULT_PAGE;
    const limit = Math.min(
      options.limit ?? APP_CONSTANTS.DEFAULT_LIMIT,
      APP_CONSTANTS.MAX_LIMIT
    );
    const skip = (page - 1) * limit;

    const queryFilter = {
      ...filter,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [totalItems, data] = await Promise.all([
      this.model.countDocuments(queryFilter as any).exec(),
      this.buildPaginatedQuery(
        queryFilter as FilterQuery<T>,
        options,
        skip,
        limit
      ),
    ]);

    const { totalPages, hasNextPage, hasPreviousPage } = calculatePagination(
      totalItems,
      page,
      limit
    );

    const pagination: PaginationMeta = {
      page,
      limit,
      totalItems,
      totalPages,
      hasNextPage,
      hasPreviousPage,
    };

    return { data, pagination };
  }

  async update(
    id: string | Types.ObjectId,
    data: UpdateQuery<T>
  ): Promise<T | null> {
    const filter = {
      _id: new Types.ObjectId(id.toString()),
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await this.model
      .findOneAndUpdate(
        filter as any,
        { $set: data },
        { new: true, runValidators: true }
      )
      .lean()
      .exec();

    return result as T | null;
  }

  async updateMany(
    filter: FilterQuery<T>,
    data: UpdateQuery<T>
  ): Promise<{ modifiedCount: number }> {
    const queryFilter = {
      ...filter,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await this.model
      .updateMany(queryFilter as any, { $set: data }, { runValidators: true })
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  async softDelete(id: string | Types.ObjectId): Promise<T | null> {
    const filter = {
      _id: new Types.ObjectId(id.toString()),
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await this.model
      .findOneAndUpdate(
        filter as any,
        {
          $set: {
            deletedAt: new Date(),
            isDeleted: true,
          },
        } as UpdateQuery<T>,
        { new: true }
      )
      .lean()
      .exec();

    return result as T | null;
  }

  async softDeleteMany(
    filter: FilterQuery<T>
  ): Promise<{ modifiedCount: number }> {
    const queryFilter = {
      ...filter,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await this.model
      .updateMany(
        queryFilter as any,
        {
          $set: {
            deletedAt: new Date(),
            isDeleted: true,
          },
        } as UpdateQuery<T>
      )
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  async hardDelete(id: string | Types.ObjectId): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await this.model
      .deleteOne({ _id: new Types.ObjectId(id.toString()) } as any)
      .exec();
    return result.deletedCount > 0;
  }

  async restore(id: string | Types.ObjectId): Promise<T | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id.toString()) } as any,
        {
          $set: {
            deletedAt: null,
            isDeleted: false,
          },
        } as UpdateQuery<T>,
        { new: true }
      )
      .lean()
      .exec();

    return result as T | null;
  }

  async count(filter: FilterQuery<T> = {} as FilterQuery<T>): Promise<number> {
    const queryFilter = {
      ...filter,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.model.countDocuments(queryFilter as any).exec();
  }

  async exists(filter: FilterQuery<T>): Promise<boolean> {
    const queryFilter = {
      ...filter,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await this.model.exists(queryFilter as any);
    return result !== null;
  }

  private async buildPaginatedQuery(
    filter: FilterQuery<T>,
    options: QueryOptions,
    skip: number,
    limit: number
  ): Promise<T[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = this.model
      .find(filter as any)
      .skip(skip)
      .limit(limit);

    if (options.select) {
      query = query.select(options.select.join(" "));
    }

    if (options.sort) {
      query = query.sort(options.sort);
    } else {
      // Default sort by createdAt descending
      query = query.sort({ createdAt: -1 });
    }

    if (options.populate) {
      query = this.applyPopulate(query, options.populate);
    }

    const result = await query.lean().exec();
    return result as T[];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private applyPopulate(
    query: any,
    populate: string | string[] | PopulateOptions[]
  ): any {
    if (typeof populate === "string") {
      return query.populate(populate);
    }

    if (Array.isArray(populate)) {
      let result = query;
      populate.forEach((pop) => {
        if (typeof pop === "string") {
          result = result.populate(pop);
        } else {
          result = result.populate(pop);
        }
      });
      return result;
    }

    return query;
  }
}
