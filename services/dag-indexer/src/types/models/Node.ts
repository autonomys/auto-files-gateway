// Auto-generated , DO NOT EDIT
import {Entity, FunctionPropertyNames, FieldsExpression, GetOptions } from "@subql/types-core";
import assert from 'assert';

import { 
    FileUploadOptions,
} from '../interfaces';



export type NodeProps = Omit<Node, NonNullable<FunctionPropertyNames<Node>> | '_name'>;

/*
 * Compat types allows for support of alternative `id` types without refactoring the node
 */
type CompatNodeProps = Omit<NodeProps, 'id'> & { id: string; };
type CompatEntity = Omit<Entity, 'id'> & { id: string; };

export class Node implements CompatEntity {

    constructor(
        
        id: string,
        blockHeight: bigint,
        blockHash: string,
        extrinsicId: string,
        extrinsicHash: string,
        indexInBlock: number,
        links: string[],
        size: bigint,
        blake3Hash: string,
        timestamp: Date,
    ) {
        this.id = id;
        this.blockHeight = blockHeight;
        this.blockHash = blockHash;
        this.extrinsicId = extrinsicId;
        this.extrinsicHash = extrinsicHash;
        this.indexInBlock = indexInBlock;
        this.links = links;
        this.size = size;
        this.blake3Hash = blake3Hash;
        this.timestamp = timestamp;
        
    }

    public id: string;
    public blockHeight: bigint;
    public blockHash: string;
    public extrinsicId: string;
    public extrinsicHash: string;
    public indexInBlock: number;
    public links: string[];
    public size: bigint;
    public blake3Hash: string;
    public timestamp: Date;
    public uploadOptions?: FileUploadOptions;
    

    get _name(): string {
        return 'Node';
    }

    async save(): Promise<void> {
        const id = this.id;
        assert(id !== null, "Cannot save Node entity without an ID");
        await store.set('Node', id.toString(), this as unknown as CompatNodeProps);
    }

    static async remove(id: string): Promise<void> {
        assert(id !== null, "Cannot remove Node entity without an ID");
        await store.remove('Node', id.toString());
    }

    static async get(id: string): Promise<Node | undefined> {
        assert((id !== null && id !== undefined), "Cannot get Node entity without an ID");
        const record = await store.get('Node', id.toString());
        if (record) {
            return this.create(record as unknown as NodeProps);
        } else {
            return;
        }
    }


    /**
     * Gets entities matching the specified filters and options.
     *
     * ⚠️ This function will first search cache data followed by DB data. Please consider this when using order and offset options.⚠️
     * */
    static async getByFields(filter: FieldsExpression<NodeProps>[], options: GetOptions<NodeProps>): Promise<Node[]> {
        const records = await store.getByFields<CompatNodeProps>('Node', filter  as unknown as FieldsExpression<CompatNodeProps>[], options as unknown as GetOptions<CompatNodeProps>);
        return records.map(record => this.create(record as unknown as NodeProps));
    }

    static create(record: NodeProps): Node {
        assert(record.id !== undefined && record.id !== null, "id must be provided");
        const entity = new this(
            record.id,
            record.blockHeight,
            record.blockHash,
            record.extrinsicId,
            record.extrinsicHash,
            record.indexInBlock,
            record.links,
            record.size,
            record.blake3Hash,
            record.timestamp,
        );
        Object.assign(entity,record);
        return entity;
    }
}
